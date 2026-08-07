"""Staging a transaction import run before it is committed"""

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import PermissionLevel
from app.models.import_run import ImportRun, ImportStagedRow
from app.models.user import User
from app.permissions import check_account_access
from app.schemas.transaction import (
    MAX_IMPORT_MAPPINGS,
    TransactionImportAccountMapping,
    TransactionImportCategoryMapping,
    TransactionImportMerchantMapping,
    TransactionImportStageRequest,
)
from app.services.importers.generic.run_locking import load_locked_run
from app.services.importers.shared.account_creation_helpers import (
    parse_import_account_type,
    validate_import_account_currency,
    validate_import_account_institution,
)
from app.services.importers.shared.categories import (
    get_visible_import_category,
    parse_import_category_kind,
)
from app.services.importers.shared.merchants import require_usable_import_merchant
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


async def open_import_run(db: AsyncSession, user: User, expected_transaction_count: int) -> ImportRun:
    """Open a run for a file about to be staged

    Args:
        db: Active database session
        user: Authenticated user running the import
        expected_transaction_count: Rows the whole file will write

    Returns:
        The opened run
    """
    run = ImportRun(
        owner_id=user.id,
        expected_transaction_count=expected_transaction_count,
        account_mappings={},
        category_mappings={},
        merchant_mappings={},
    )
    db.add(run)
    await db.commit()
    return run


async def stage_import_batch(
    db: AsyncSession,
    user: User,
    run_id: uuid.UUID,
    data: TransactionImportStageRequest,
) -> None:
    """Park one batch of a file against its run, after checking the mappings it declares

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
            422 for a batch reaching past the file's row count, re-declaring a source differently,
            or declaring a mapping staging can already tell is unusable
    """
    run = await _load_uncommitted_run(db, run_id)

    last_row_index = data.start_row_index + len(data.rows)
    if last_row_index > run.expected_transaction_count:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This batch reaches row {last_row_index} of an import declaring {run.expected_transaction_count}",
        )

    for account_mapping in data.accounts:
        await _validate_account_mapping(db, user, account_mapping)
    for category_mapping in data.categories:
        await _validate_category_mapping(db, user, category_mapping)
    for merchant_mapping in data.merchants:
        await _validate_merchant_mapping(db, user, merchant_mapping)

    # Reassigned rather than mutated, since SQLAlchemy tracks a JSONB column by identity and would
    # not see a change made inside the dictionary it already holds
    run.account_mappings = _merge_import_mappings(run.account_mappings, data.accounts, "Account source")
    run.category_mappings = _merge_import_mappings(run.category_mappings, data.categories, "Category source")
    run.merchant_mappings = _merge_import_mappings(run.merchant_mappings, data.merchants, "Merchant source")

    await _insert_staged_rows(db, run, user.id, data)
    await db.commit()


async def delete_import_run(db: AsyncSession, user: User, run_id: uuid.UUID) -> None:
    """Drop a staged run and everything staged under it

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
    run = await _load_uncommitted_run(db, run_id)
    await db.delete(run)
    await db.commit()


async def _load_uncommitted_run(db: AsyncSession, run_id: uuid.UUID) -> ImportRun:
    """Return the caller's run, held for the rest of the transaction, when it is still open

    The row-level security policy is what scopes this to the caller, so another user's run is
    absent rather than refused

    Args:
        db: Active database session
        run_id: Run to load

    Returns:
        The open run

    Raises:
        HTTPException: Raised with 404 when there is no such run of the caller's, 409 when it has
            already been committed, and 409 when another request is working on it
    """
    run = await load_locked_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import run not found")
    if run.committed_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This import has already been committed")
    return run


def _merge_import_mappings(
    stored: dict[str, Any],
    mappings: (
        list[TransactionImportAccountMapping]
        | list[TransactionImportCategoryMapping]
        | list[TransactionImportMerchantMapping]
    ),
    label: str,
) -> dict[str, Any]:
    """Merge one batch's mappings into what the run already holds, keyed by trimmed source

    Re-sending a batch merges the same answers again, which is why an identical re-declaration is
    accepted while a different one is refused

    The merged total is capped as well as each batch, because a batch cap alone bounds nothing: the
    same positions can be staged over and over, where the unique constraint absorbs the repeated
    rows while every batch adds more mappings to what the run holds

    Args:
        stored: Mappings the run already holds
        mappings: Mappings this batch declares
        label: What a source is called in a refusal

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
        existing = merged.get(source)
        if existing is not None and existing != declared:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"{label} is declared twice with different answers: {source}",
            )
        merged[source] = declared

    if len(merged) > MAX_IMPORT_MAPPINGS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"This import declares {len(merged)} distinct values for {label}, and the limit is {MAX_IMPORT_MAPPINGS}",
        )
    return merged


async def _insert_staged_rows(
    db: AsyncSession,
    run: ImportRun,
    owner_id: uuid.UUID,
    data: TransactionImportStageRequest,
) -> None:
    """Park one batch's rows at their positions in the file

    A batch whose response was lost is sent again at the same positions, so the insert leaves the
    copies already staged alone rather than failing on them. A position keeps what it was first
    given even where the second copy differs, which only a caller writing its own requests can do

    Args:
        db: Active database session
        run: Run the rows belong to
        owner_id: Identifier for the user running the import
        data: The batch being staged

    Returns:
        None
    """
    values = [
        {
            "id": uuid.uuid4(),
            "import_run_id": run.id,
            "owner_id": owner_id,
            "row_index": data.start_row_index + offset,
            "payload": row.model_dump(mode="json"),
        }
        for offset, row in enumerate(data.rows)
    ]
    await db.execute(
        insert(ImportStagedRow)
        .values(values)
        .on_conflict_do_nothing(constraint="uq_import_staged_row_run_index"),
    )


async def _validate_account_mapping(
    db: AsyncSession,
    user: User,
    mapping: TransactionImportAccountMapping,
) -> None:
    """Check one account mapping as far as staging can, without creating anything

    An existing account is only checked for read access here. Whether rows are written to it, which
    is what asks for write access to an open account, depends on the rows of the whole file, so the
    commit is the first point that can tell

    Args:
        db: Active database session
        user: Authenticated user running the import
        mapping: Account source mapping from the batch

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
        await check_account_access(db, mapping.account_id, user.id, PermissionLevel.READ)
        return

    parse_import_account_type(mapping.create.account_type)
    await validate_import_account_currency(db, mapping.create.currency.upper())
    await validate_import_account_institution(db, mapping.create.institution_id)


async def _validate_category_mapping(
    db: AsyncSession,
    user: User,
    mapping: TransactionImportCategoryMapping,
) -> None:
    """Check one category mapping as far as staging can, without creating anything

    Args:
        db: Active database session
        user: Authenticated user running the import
        mapping: Category source mapping from the batch

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
        await get_visible_import_category(db, mapping.category_id, user.id)
        return

    parse_import_category_kind(mapping.create.kind)


async def _validate_merchant_mapping(
    db: AsyncSession,
    user: User,
    mapping: TransactionImportMerchantMapping,
) -> None:
    """Check one merchant mapping as far as staging can, without creating anything

    Args:
        db: Active database session
        user: Authenticated user running the import
        mapping: Payee value answered in the batch

    Returns:
        None

    Raises:
        HTTPException: Raised with 422 when the mapping states no single merchant action, and when
            it points at a merchant this import cannot use
    """
    source = strip_import_text_or_raise(mapping.source, "Merchant source")

    stated_actions = (mapping.merchant_id is not None) + (mapping.create is not None) + mapping.skip
    if stated_actions != 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Merchant source must map to exactly one merchant action: {source}",
        )

    if mapping.merchant_id is not None:
        await require_usable_import_merchant(db, mapping.merchant_id, user.id)
