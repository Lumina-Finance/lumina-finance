"""Staging a Firefly III export as an import run, and committing it in one transaction"""

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
from app.schemas.firefly_import import (
    FireflyBudgetImportResult,
    FireflyImportRunResponse,
    FireflyImportStageRequest,
    FireflyTransactionRow,
)
from app.schemas.import_run import ImportBudgetDraft
from app.schemas.transaction import TransactionImportAccountMapping, TransactionImportCategoryMapping
from app.services.accounts.balance_adjustments import (
    validate_no_transactions_after_archive_date,
    zero_account_balance_for_archive,
)
from app.services.cache_state import mark_cache_changed_for_scope
from app.services.importers.firefly.budgets import FireflyBudgetImport, write_firefly_budgets
from app.services.importers.firefly.service import FireflyWriteResult, write_firefly_transactions
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
from app.utils.dates import resolve_timezone


async def stage_firefly_batch(
    db: AsyncSession,
    user: User,
    run_id: uuid.UUID,
    data: FireflyImportStageRequest,
) -> None:
    """Park one batch of a Firefly III export against its run, after checking its mappings

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
            422 for a run another importer opened, a batch reaching past the export's row count,
            re-declaring a source differently, or declaring a mapping staging can already tell is
            unusable
    """
    run = await load_uncommitted_run(db, run_id, ImportRunSource.FIREFLY)
    require_batch_within_run(run, data.start_row_index, len(data.rows))

    references = await load_staging_references(db, user, data.accounts, data.categories)
    for account_mapping in data.accounts:
        await validate_account_mapping(db, user, account_mapping, references)
    for category_mapping in data.categories:
        await validate_category_mapping(db, user, category_mapping, references)

    # Reassigned rather than mutated, since SQLAlchemy tracks a JSONB column by identity and would
    # not see a change made inside the dictionary it already holds
    run.account_mappings = merge_import_mappings(run.account_mappings, data.accounts, "Account source")
    run.category_mappings = merge_import_mappings(run.category_mappings, data.categories, "Category source")

    await insert_staged_rows(db, run, user.id, data.start_row_index, data.rows)
    await db.commit()


async def commit_firefly_run(db: AsyncSession, user: User, run_id: uuid.UUID) -> FireflyImportRunResponse:
    """Write a staged Firefly III export in one transaction: its rows, then budgets, then archiving

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
            account they cannot reach, 409 when another request holds the run, and 422 when another
            importer opened the run, when the staged rows do not add up to the export the run
            declared, when a row cannot be written (naming the row's journal), when a budget names a category
            source with no mapping or cannot be created, or when an account cannot be archived
    """
    run = await lock_run_for_commit(db, run_id, ImportRunSource.FIREFLY)
    if run.committed_at is not None:
        return FireflyImportRunResponse.model_validate(run.summary)

    staged_rows = await get_every_staged_row(db, run)
    written = await write_firefly_transactions(
        db,
        user,
        [TransactionImportAccountMapping.model_validate(mapping) for mapping in run.account_mappings.values()],
        [TransactionImportCategoryMapping.model_validate(mapping) for mapping in run.category_mappings.values()],
        [FireflyTransactionRow.model_validate(row.payload) for row in staged_rows],
    )

    budgets = [
        _resolve_budget_categories(ImportBudgetDraft.model_validate(draft), written.categories_by_source)
        for draft in run.budget_drafts
    ]
    budget_results = await write_firefly_budgets(db, user, budgets)
    archived_count, adjustment_count = await _archive_accounts(db, user, run, written)

    response = _build_response(written, len(staged_rows), budget_results, archived_count, adjustment_count)
    await finish_run_commit(db, run, response)
    return response


def _resolve_budget_categories(
    draft: ImportBudgetDraft,
    categories_by_source: dict[str, Category],
) -> FireflyBudgetImport:
    """Turn a budget draft's category sources into the categories the commit resolved them to

    Args:
        draft: Budget as staged, naming its categories by mapping source
        categories_by_source: Categories the commit resolved or created, by mapping source

    Returns:
        The budget as the budget import takes it

    Raises:
        HTTPException: Raised with 422 naming the budget when a category source is blank or has no
            mapping in the run
    """
    category_ids = []
    for category_source in draft.category_sources:
        # Trimmed as the category mappings are, so a source here names the same mapping
        source = category_source.strip()
        if not source:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{draft.name}: a category source is blank",
            )
        category = categories_by_source.get(source)
        if category is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{draft.name}: category source {source} has no category mapping in this import",
            )
        category_ids.append(category.id)

    return FireflyBudgetImport(
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
    written: FireflyWriteResult,
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
        account: Account | None = written.accounts_by_source.get(source)
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


def _build_response(
    written: FireflyWriteResult,
    rows_imported: int,
    budget_results: list[FireflyBudgetImportResult],
    archived_count: int,
    adjustment_count: int,
) -> FireflyImportRunResponse:
    """Build the commit's summary

    Args:
        written: What the commit's rows created
        rows_imported: Journal rows the run staged, every one of them written
        budget_results: Budgets created with their period counts
        archived_count: Accounts archived
        adjustment_count: Balance adjustments archiving added

    Returns:
        The commit's summary
    """
    stats = written.stats
    return FireflyImportRunResponse(
        rows_imported=rows_imported,
        transactions_created=written.legs_created,
        accounts_created=stats.accounts_created,
        accounts_reused=stats.accounts_reused,
        categories_created=stats.categories_created,
        categories_reused=stats.categories_reused,
        merchants_created=stats.merchants_created,
        merchants_reused=stats.merchants_reused,
        tags_created=stats.tags_created,
        tags_reused=stats.tags_reused,
        budgets_created=len(budget_results),
        budgets=budget_results,
        accounts_archived=archived_count,
        archive_adjustments_created=adjustment_count,
        affected_account_ids=list(written.first_import_date_by_account_id.keys()),
        account_source_ids={source: account.id for source, account in written.accounts_by_source.items()},
        category_source_ids={source: category.id for source, category in written.categories_by_source.items()},
        created_account_ids=stats.created_account_ids,
        created_category_ids=stats.created_category_ids,
        created_merchant_ids=stats.created_merchant_ids,
        created_tag_ids=stats.created_tag_ids,
    )
