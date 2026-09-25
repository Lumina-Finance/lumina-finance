"""Staging steps every import run shares, whichever importer opened it"""

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.category import Category
from app.models.import_run import ImportRun, ImportRunSource, ImportStagedRow
from app.models.merchant import Merchant
from app.models.user import User
from app.permissions import check_account_access
from app.permissions.accounts import AccountAccessLookup, load_account_access_lookup
from app.schemas.import_run import ImportRunArchiveRequest, ImportRunBudgetsRequest
from app.schemas.transaction import (
    MAX_IMPORT_MAPPINGS,
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
    TransactionImportMerchantMapping,
)
from app.services.importers.shared.account_creation_helpers import (
    load_import_account_references,
    parse_import_account_type,
    validate_import_account_currency,
    validate_import_account_institution,
)
from app.services.importers.shared.categories import (
    get_visible_import_category,
    load_visible_import_categories,
    parse_import_category_kind,
)
from app.services.importers.shared.merchants import load_import_merchant_keys, load_usable_import_merchants
from app.services.importers.shared.run_locking import load_locked_run
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise

# How a refusal names the importer a run belongs to
_RUN_SOURCE_LABELS = {
    ImportRunSource.GENERIC: "a CSV import",
    ImportRunSource.FIREFLY: "a Firefly III import",
    ImportRunSource.ACTUAL_BUDGET: "an Actual Budget import",
}


@dataclass
class StagingReferences:
    """Complete caller-local reference facts used only by one staging request"""

    account_access: AccountAccessLookup
    currencies: set[str]
    institutions: set[uuid.UUID]
    categories: dict[uuid.UUID, Category]
    merchants: dict[uuid.UUID, Merchant]
    merchant_keys: dict[str, str]


async def load_staging_references(
    db: AsyncSession,
    user: User,
    accounts: Sequence[TransactionImportAccountMapping],
    categories: Sequence[TransactionImportCategoryMapping],
    merchants: Sequence[TransactionImportMerchantMapping] = (),
) -> StagingReferences:
    """Acquire reference facts without validating or reordering declaration errors

    Args:
        db: Active caller-scoped staging session
        user: Authenticated importer
        accounts: Account mappings the request declares
        categories: Category mappings the request declares
        merchants: Payee answers the request declares, which only the generic import has

    Returns:
        Complete request-local facts, with unavailable references absent
    """
    account_ids = {mapping.account_id for mapping in accounts if mapping.account_id is not None}
    creates = [mapping.create for mapping in accounts if mapping.create is not None]
    currencies, institutions = await load_import_account_references(
        db, {create.currency.upper() for create in creates},
        {create.institution_id for create in creates if create.institution_id is not None},
    )
    account_access = await load_account_access_lookup(db, account_ids, user.id)
    visible_categories = await load_visible_import_categories(
        db, {mapping.category_id for mapping in categories if mapping.category_id is not None}, user.id,
    )
    usable_merchants = await load_usable_import_merchants(
        db, {mapping.merchant_id for mapping in merchants if mapping.merchant_id is not None}, user.id,
    )
    merchant_keys = await load_import_merchant_keys(db, {mapping.source.strip() for mapping in merchants})
    return StagingReferences(account_access, currencies, institutions, visible_categories, usable_merchants, merchant_keys)


async def open_import_run(
    db: AsyncSession, user: User, expected_transaction_count: int, source: ImportRunSource,
) -> ImportRun:
    """Open a run for a file about to be staged

    Args:
        db: Active database session
        user: Authenticated user running the import
        expected_transaction_count: Rows the whole file will write
        source: Importer opening the run, which decides what its rows hold and which commit writes them

    Returns:
        The opened run
    """
    run = ImportRun(
        owner_id=user.id,
        source=source,
        expected_transaction_count=expected_transaction_count,
        account_mappings={},
        category_mappings={},
        merchant_mappings={},
        budget_drafts=[],
        archive_account_sources=[],
    )
    db.add(run)
    await db.commit()
    return run


async def delete_import_run(db: AsyncSession, user: User, run_id: uuid.UUID) -> None:
    """Drop a staged run and everything staged under it, whichever importer opened it

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run to drop

    Returns:
        None

    Raises:
        HTTPException: Raised with 404 for a run that is not the caller's, 409 for one already
            committed, whose rows are in the ledger and are not this endpoint's to remove, and 409
            for one another request is working on
    """
    # Held for the same reason every other request holds it: read without the lock, a delete
    # arriving while a commit is running reads the run before it was stamped and then removes one
    # whose rows have just landed
    run = await load_uncommitted_run(db, run_id)
    await db.delete(run)
    await db.commit()


async def stage_import_budgets(db: AsyncSession, user: User, run_id: uuid.UUID, data: ImportRunBudgetsRequest) -> None:
    """Replace the budgets a provider run creates once its transactions are written

    Replacing rather than adding is what lets a request whose response was lost be sent again.
    The category mappings the budgets name are merged like a batch's, since a budget can track a
    category no staged row uses. Whether every named source has a mapping is checked at the
    commit, which is the first point that has every batch

    Args:
        db: Active database session
        user: Authenticated user running the import
        run_id: Run the budgets belong to
        data: Budget drafts and the category mappings they need

    Returns:
        None

    Raises:
        HTTPException: Raised with 404 for a run that is not the caller's, 409 for a run already
            committed or one another request is working on, and 422 for a generic CSV run, which
            has no budgets, or a category mapping staging can already tell is unusable
    """
    run = await load_uncommitted_run(db, run_id)
    if run.source == ImportRunSource.GENERIC:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A CSV import has no budgets")

    references = await load_staging_references(db, user, [], data.categories)
    for category_mapping in data.categories:
        await validate_category_mapping(db, user, category_mapping, references)

    run.category_mappings = merge_import_mappings(run.category_mappings, data.categories, "Category source")
    run.budget_drafts = [budget.model_dump(mode="json") for budget in data.budgets]
    await db.commit()


async def stage_import_archive(db: AsyncSession, run_id: uuid.UUID, data: ImportRunArchiveRequest) -> None:
    """Replace the accounts a provider run archives once everything else is written

    Args:
        db: Active database session
        run_id: Run the list belongs to
        data: Account mapping sources to archive

    Returns:
        None

    Raises:
        HTTPException: Raised with 404 for a run that is not the caller's, 409 for a run already
            committed or one another request is working on, and 422 for a generic CSV run, which
            archives nothing
    """
    run = await load_uncommitted_run(db, run_id)
    if run.source == ImportRunSource.GENERIC:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A CSV import archives no accounts")

    # Trimmed as the account mappings are, so a source here names the same mapping, and each kept
    # once since archiving an account twice is archiving it once
    sources = [strip_import_text_or_raise(source, "Account source") for source in data.account_sources]
    run.archive_account_sources = list(dict.fromkeys(sources))
    await db.commit()


async def load_uncommitted_run(db: AsyncSession, run_id: uuid.UUID, source: ImportRunSource | None = None) -> ImportRun:
    """Return the caller's run, held for the rest of the transaction, when it is still open

    The row-level security policy is what scopes this to the caller, so another user's run is
    absent rather than refused

    Args:
        db: Active database session
        run_id: Run to load
        source: Importer the request belongs to, or None for a request any run takes

    Returns:
        The open run

    Raises:
        HTTPException: Raised with 404 when there is no such run of the caller's, 409 when it has
            already been committed or another request is working on it, and 422 when another
            importer opened it
    """
    run = await load_locked_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found")
    if run.committed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This import has already been committed")
    if source is not None:
        require_run_source(run, source)
    return run


def require_run_source(run: ImportRun, source: ImportRunSource) -> None:
    """Refuse a request sent to a run another importer opened

    Each importer's rows are read by its own commit, so a row staged under the wrong one would be
    read as something it is not

    Args:
        run: Run the request names
        source: Importer the request belongs to

    Raises:
        HTTPException: Raised with 422 when the run belongs to a different importer
    """
    if run.source != source:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This import run is {_RUN_SOURCE_LABELS[run.source]}",
        )


def require_batch_within_run(run: ImportRun, start_row_index: int, row_count: int) -> None:
    """Refuse a batch reaching past the number of rows its run was opened for

    Args:
        run: Run the batch belongs to
        start_row_index: Where the batch starts in the file
        row_count: Rows the batch carries

    Raises:
        HTTPException: Raised with 422 when the batch ends past the run's declared row count
    """
    last_row_index = start_row_index + row_count
    if last_row_index > run.expected_transaction_count:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This batch reaches row {last_row_index} of an import declaring {run.expected_transaction_count}",
        )


def merge_import_mappings(
    stored: dict[str, Any],
    mappings: (
        Sequence[TransactionImportAccountMapping]
        | Sequence[TransactionImportCategoryMapping]
        | Sequence[TransactionImportMerchantMapping]
    ),
    label: str,
    get_key: Callable[[str], str] = lambda source: source,
) -> dict[str, Any]:
    """Merge one batch's mappings into what the run already holds, one entry per source

    Re-sending a batch merges the same answers again, which is why an identical re-declaration is
    accepted while a different one is refused

    The merged total is capped as well as each batch, because a batch cap alone bounds nothing: the
    same positions can be staged over and over, where the unique constraint absorbs the repeated
    rows while every batch adds more mappings to what the run holds

    Args:
        stored: Mappings the run already holds
        mappings: Mappings this batch declares
        label: What a source is called in a refusal
        get_key: What a source is held under, which is the trimmed source itself except for a payee
            value, where two spellings are one merchant and so one answer

    Returns:
        The merged mappings

    Raises:
        HTTPException: Raised with 422 when a source is declared differently from before, and when
            the run would end up holding more mappings than an import may declare
    """
    merged = dict(stored)

    for mapping in mappings:
        source = strip_import_text_or_raise(mapping.source, label)
        declared = mapping.model_dump(mode="json") | {"source": source}
        key = get_key(source)
        existing = merged.get(key)
        if existing is not None and existing != declared:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{label} is declared twice with different answers: {source}",
            )
        merged[key] = declared

    if len(merged) > MAX_IMPORT_MAPPINGS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This import declares {len(merged)} distinct values for {label}, and the limit is {MAX_IMPORT_MAPPINGS}",
        )
    return merged


async def insert_staged_rows(
    db: AsyncSession,
    run: ImportRun,
    owner_id: uuid.UUID,
    start_row_index: int,
    rows: Sequence[BaseModel],
) -> None:
    """Park one batch's rows at their positions in the file

    A batch whose response was lost is sent again at the same positions, so the insert leaves the
    copies already staged alone rather than failing on them. A position keeps what it was first
    given even where the second copy differs, which only a caller writing its own requests can do

    Args:
        db: Active database session
        run: Run the rows belong to
        owner_id: Identifier for the user running the import
        start_row_index: Where the batch starts in the file
        rows: The batch's rows, in the shape the run's importer stages

    Returns:
        None
    """
    values = [
        {
            "id": uuid.uuid4(),
            "import_run_id": run.id,
            "owner_id": owner_id,
            "row_index": start_row_index + offset,
            "payload": row.model_dump(mode="json"),
        }
        for offset, row in enumerate(rows)
    ]
    await db.execute(
        insert(ImportStagedRow)
        .values(values)
        .on_conflict_do_nothing(constraint="uq_import_staged_row_run_index"),
    )


async def validate_account_mapping(
    db: AsyncSession,
    user: User,
    mapping: TransactionImportAccountMapping,
    references: StagingReferences,
) -> None:
    """Check one account mapping as far as staging can, without creating anything

    An existing account is only checked for read access here. Whether rows are written to it, which
    is what asks for write access to an unarchived account, depends on the rows of the whole file, so
    the commit is the first point that can tell

    Args:
        db: Active database session
        user: Authenticated user running the import
        mapping: Account source mapping from the batch
        references: Complete caller-local reference facts for this staging request

    Returns:
        None

    Raises:
        HTTPException: Raised with 404 when the account it states is one the user cannot reach, and
            with 422 when the mapping states no single account action, or states a currency,
            institution or account type that does not exist
    """
    source = strip_import_text_or_raise(mapping.source, "Account source")

    if mapping.outside:
        if mapping.account_id is not None or mapping.create is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Account source must map to exactly one account action: {source}",
            )
        return

    if (mapping.account_id is None) == (mapping.create is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Account source must map to exactly one account action: {source}",
        )

    if mapping.account_id is not None:
        await check_account_access(
            db, mapping.account_id, user.id, PermissionLevel.READ, access_lookup=references.account_access,
        )
        return

    parse_import_account_type(mapping.create.account_type)
    await validate_import_account_currency(db, mapping.create.currency.upper(), existing_currencies=references.currencies)
    await validate_import_account_institution(db, mapping.create.institution_id, existing_institutions=references.institutions)


async def validate_category_mapping(
    db: AsyncSession,
    user: User,
    mapping: TransactionImportCategoryMapping,
    references: StagingReferences,
) -> None:
    """Check one category mapping as far as staging can, without creating anything

    Args:
        db: Active database session
        user: Authenticated user running the import
        mapping: Category source mapping from the batch
        references: Complete caller-local reference facts for this staging request

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when the mapping states no single category action, states a
            category the user cannot see, or states a kind that does not exist
    """
    source = strip_import_text_or_raise(mapping.source, "Category source")

    if (mapping.category_id is None) == (mapping.create is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Category source must map to exactly one category action: {source}",
        )

    if mapping.category_id is not None:
        await get_visible_import_category(db, mapping.category_id, user.id, categories_by_id=references.categories)
        return

    parse_import_category_kind(mapping.create.kind)
