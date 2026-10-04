"""Staging a Firefly III or Actual Budget journal as an import run, and committing it in one transaction"""

import uuid
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import PermissionLevel
from app.models.category import Category
from app.models.import_run import ImportRun, ImportRunSource
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.import_run import (
    ImportBudgetDraft,
    JournalImportRunResponse,
    JournalImportStageRequest,
    JournalTransactionRow,
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
)
from app.services.accounts.balance_adjustments import (
    validate_no_transactions_after_archive_date,
    zero_account_balance_for_archive,
)
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.importers.journal.budgets import JournalBudgetImport, write_journal_budgets
from app.services.importers.journal.constants import JOURNAL_RUN_SOURCES
from app.services.importers.journal.service import JournalWriteResult, write_journal_transactions
from app.services.importers.shared.run_commit import finish_run_commit, get_every_staged_row, lock_run_for_commit
from app.services.importers.shared.run_staging import (
    insert_staged_rows,
    load_staging_references,
    load_uncommitted_run,
    merge_import_mappings,
    require_batch_within_run,
    validate_account_mapping,
    validate_category_mapping,
)
from app.services.importers.shared.save_results import build_import_summary
from app.utils.dates import resolve_timezone


async def stage_journal_batch(
    db: AsyncSession,
    user: User,
    run_id: uuid.UUID,
    data: JournalImportStageRequest,
) -> None:
    """Park one batch of a journal export against its run, after checking its mappings

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run the batch belongs to
        data: Mappings this batch's rows reference, and the rows themselves

    Returns:
        None

    Raises:
        HTTPException: Raised with 404 for a run that is not the caller's or a mapped account they
            cannot reach, 409 for a run already committed or one another request is working on, and
            422 for a run a non-journal importer opened, a batch reaching past the export's row count,
            re-declaring a source differently, or declaring a mapping staging can already tell is
            unusable
    """
    run = await load_uncommitted_run(db, run_id, JOURNAL_RUN_SOURCES)
    require_batch_within_run(run, data.start_row_index, len(data.rows))

    references = await load_staging_references(db, user, data.accounts, data.categories)
    for account_mapping in data.accounts:
        # Every journal account source is an endpoint rows are written to, and the journal states
        # both sides of a transfer itself, so there is nothing here an outside answer could describe.
        # Money leaving the tracked accounts is a withdrawal or deposit to a payee under a transfer
        # category instead, which records the outside counterparty. Refusing it here rather than at
        # the commit keeps the run open for the corrected answer
        if account_mapping.outside:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Account source cannot be outside the tracked accounts: {account_mapping.source}",
            )
        await validate_account_mapping(db, user, account_mapping, references)
    for category_mapping in data.categories:
        await validate_category_mapping(db, user, category_mapping, references)

    # Reassigned rather than mutated, since SQLAlchemy tracks a JSONB column by identity and would
    # not see a change made inside the dictionary it already holds
    run.account_mappings = merge_import_mappings(run.account_mappings, data.accounts, "Account source")
    run.category_mappings = merge_import_mappings(run.category_mappings, data.categories, "Category source")

    await insert_staged_rows(db, run, user.id, data.start_row_index, data.rows)
    await db.commit()


async def commit_journal_run(db: AsyncSession, user: User, run_id: uuid.UUID) -> JournalImportRunResponse:
    """Write a staged journal export in one transaction: its rows, then budgets, then archiving

    Accounts, categories, merchants and tags are created as the rows need them, budgets then look
    up categories the same commit created, and archiving comes last so it sees every row. Nothing
    is committed until all of it has been written, so a failure at any stage leaves nothing saved
    and the run can be committed again. A run already committed answers with the summary it
    returned the first time

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run to commit

    Returns:
        Summary of everything the commit wrote

    Raises:
        HTTPException: Raised with 404 for a run that is absent or not the caller's, or a mapped
            account they cannot reach, 409 when another request holds the run, and 422 when a
            non-journal importer opened the run, when the staged rows do not add up to the export the
            run declared, when a row cannot be written (naming the row as the export does), when a budget names a category
            source with no mapping or cannot be created, or when an account cannot be archived
    """
    run = await lock_run_for_commit(db, run_id, JOURNAL_RUN_SOURCES)
    if run.committed_at is not None:
        return JournalImportRunResponse.model_validate(run.summary)

    staged_rows = await get_every_staged_row(db, run)
    written = await write_journal_transactions(
        db,
        user,
        ImportRunSource(run.source),
        [TransactionImportAccountMapping.model_validate(mapping) for mapping in run.account_mappings.values()],
        [TransactionImportCategoryMapping.model_validate(mapping) for mapping in run.category_mappings.values()],
        [JournalTransactionRow.model_validate(row.payload) for row in staged_rows],
    )

    budgets = [
        _resolve_budget_categories(ImportBudgetDraft.model_validate(draft), written.import_lookups.categories_by_source)
        for draft in run.budget_drafts
    ]
    budget_results = await write_journal_budgets(db, user, budgets)
    archived_count, adjustment_count = await _archive_accounts(db, user, run, written)

    response = build_import_summary(
        JournalImportRunResponse,
        transactions_created=written.legs_created,
        stats=written.stats,
        import_lookups=written.import_lookups,
        first_import_date_by_account_id=written.first_import_date_by_account_id,
        rows_imported=len(staged_rows),
        budgets_created=len(budget_results),
        budgets=budget_results,
        accounts_archived=archived_count,
        archive_adjustments_created=adjustment_count,
    )
    await finish_run_commit(db, run, response)
    return response


def _resolve_budget_categories(
    draft: ImportBudgetDraft,
    categories_by_source: dict[str, Category],
) -> JournalBudgetImport:
    """Turn a budget draft's category sources into the categories the commit resolved them to

    Args:
        draft: Budget as staged, naming its categories by mapping source
        categories_by_source: Categories the commit resolved or created, by mapping source

    Returns:
        The budget as the budget import takes it

    Raises:
        HTTPException: Raised with 422 naming the budget when a category source has no mapping in
            the run
    """
    category_ids = []
    for source in draft.category_sources:
        category = categories_by_source.get(source)
        if category is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{draft.name}: category source {source} has no category mapping in this import",
            )
        category_ids.append(category.id)

    return JournalBudgetImport(
        name=draft.name,
        currency=draft.currency,
        category_ids=category_ids,
        limits=draft.limits,
        recurrence=draft.recurrence,
        is_archived=draft.is_archived,
    )


async def _archive_accounts(
    db: AsyncSession,
    user: User,
    run: ImportRun,
    written: JournalWriteResult,
) -> tuple[int, int]:
    """Archive the accounts the run lists, through the same rules as archiving one by hand

    Only an account this commit created can be archived. An existing account the export was mapped
    onto is the user's own to keep open or close, so naming one is refused rather than archiving it
    behind their back. An account with money left in it gets the usual adjustment to zero, dated
    the user's today, and one with rows dated after today is refused

    Args:
        db: Active database session
        user: Authenticated user running the import
        run: Run listing the account sources to archive
        written: What the commit's rows created, with the account each source resolved to

    Returns:
        How many accounts were archived, and how many of them needed a balance adjustment

    Raises:
        HTTPException: Raised with 422 naming the source when it is not an account this commit
            created or has rows dated after today, and 404 when the user cannot administer it
    """
    if not run.archive_account_sources:
        return 0, 0

    archive_date = datetime.now(resolve_timezone(user.tz)).date()
    created_account_ids = set(written.stats.created_account_ids)
    adjustment_count = 0

    for source in run.archive_account_sources:
        account: Account | None = written.import_lookups.accounts_by_source.get(source)
        if account is None or account.id not in created_account_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Account source {source} is not an account this import creates, so it can't be archived",
            )

        # Archiving takes the same access as it does by hand. Every account created here is the
        # user's own, so this holds today, and it stays a named check for when an import can
        # create accounts in a group
        await check_account_access(db, account.id, user.id, PermissionLevel.ADMIN)

        try:
            await validate_no_transactions_after_archive_date(db, account, archive_date)
        except HTTPException as exc:
            raise HTTPException(status_code=exc.status_code, detail=f"Account source {source}: {exc.detail}") from exc

        account.is_archived = True
        if await zero_account_balance_for_archive(db, account, user, archive_date):
            adjustment_count += 1
        await mark_cache_changed_for_scope(db, user_id=account.owner_id, group_id=account.group_id)

    return len(run.archive_account_sources), adjustment_count
