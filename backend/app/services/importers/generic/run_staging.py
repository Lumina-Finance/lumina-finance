"""Staging a generic CSV import run before it is committed"""

import uuid

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_run import ImportRunSource
from app.models.user import User
from app.schemas.transaction import TransactionImportMerchantMapping, TransactionImportStageRequest
from app.services.importers.shared.merchants import require_usable_import_merchant
from app.services.importers.shared.run_staging import (
    StagingReferences,
    insert_staged_rows,
    load_staging_references,
    load_uncommitted_run,
    merge_import_mappings,
    require_batch_within_run,
    validate_account_mapping,
    validate_category_mapping,
)
from app.services.importers.shared.validation_helpers import strip_import_text_or_raise


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
            422 for a run another importer opened, a batch reaching past the file's row count,
            re-declaring a source differently, or declaring a mapping staging can already tell is
            unusable
    """
    run = await load_uncommitted_run(db, run_id, ImportRunSource.GENERIC)
    require_batch_within_run(run, data.start_row_index, len(data.rows))

    references = await load_staging_references(db, user, data.accounts, data.categories, data.merchants)
    for account_mapping in data.accounts:
        await validate_account_mapping(db, user, account_mapping, references)
    for category_mapping in data.categories:
        await validate_category_mapping(db, user, category_mapping, references)
    for merchant_mapping in data.merchants:
        await _validate_merchant_mapping(db, user, merchant_mapping, references)

    # Reassigned rather than mutated, since SQLAlchemy tracks a JSONB column by identity and would
    # not see a change made inside the dictionary it already holds
    run.account_mappings = merge_import_mappings(run.account_mappings, data.accounts, "Account source")
    run.category_mappings = merge_import_mappings(run.category_mappings, data.categories, "Category source")

    # Keyed by what matches a payee rather than by the spelling, since two spellings of one payee
    # resolve to one merchant. Held apart this way, a batch answering "Amazon" and a later one
    # answering "AMAZON" differently are refused here rather than at the commit, where the run would
    # already hold both and every retry would answer the same
    run.merchant_mappings = merge_import_mappings(
        run.merchant_mappings,
        data.merchants,
        "Merchant source",
        get_key=references.merchant_keys.__getitem__,
    )

    await insert_staged_rows(db, run, user.id, data.start_row_index, data.rows)
    await db.commit()


async def _validate_merchant_mapping(
    db: AsyncSession,
    user: User,
    mapping: TransactionImportMerchantMapping,
    references: StagingReferences,
) -> None:
    """Check one merchant mapping as far as staging can, without creating anything

    Args:
        db: Active database session
        user: Authenticated user running the import
        mapping: Payee value answered in the batch
        references: Complete caller-local reference facts for this staging request

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
        await require_usable_import_merchant(db, mapping.merchant_id, user.id, merchants_by_id=references.merchants)
