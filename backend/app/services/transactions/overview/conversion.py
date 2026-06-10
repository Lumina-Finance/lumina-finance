"""Transaction overview currency conversion setup"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.services.fx import FxConverter


async def get_overview_accounts_by_id(db: AsyncSession, conversion_rows) -> dict[uuid.UUID, Account]:
    """Return accounts required for overview currency conversion

    Aggregate rows keep account IDs instead of account models, so this helper
    batches parent account loading and returns the account currency lookup used
    by every overview converter

    Args:
        db: Active database session
        conversion_rows: Overview query rows that reference account IDs

    Returns:
        Account rows keyed by account ID
    """
    account_ids = {row.account_id for row in conversion_rows}
    # Fetch accounts referenced by aggregate rows so conversion uses the account currency
    accounts = (
        (await db.execute(select(Account).where(Account.id.in_(account_ids)))).scalars().all()
        if account_ids
        else []
    )
    return {account.id: account for account in accounts}


async def prefetch_overview_rates(
    converter: FxConverter,
    *,
    conversion_rows,
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> None:
    """Prefetch FX rates needed for overview conversion rows

    Args:
        converter: Request-scoped FX converter that caches prefetched rates
        conversion_rows: Overview query rows that need currency conversion
        accounts_by_id: Account rows keyed by account ID
        base_currency: User base currency used for overview metrics

    Returns:
        None
    """
    if not conversion_rows:
        return

    start_date = min(row.date for row in conversion_rows)
    end_date = max(row.date for row in conversion_rows)

    # Prefetch each distinct account-currency to base-currency range once for the overview
    for currency in sorted({
        accounts_by_id[row.account_id].currency
        for row in conversion_rows
        if accounts_by_id[row.account_id].currency != base_currency
    }):
        await converter.prefetch_rates(
            base=currency,
            quote=base_currency,
            start_date=start_date,
            end_date=end_date,
        )


def clone_overview_converter(converter: FxConverter) -> FxConverter:
    """Clone a converter's cached state for an overview metric

    Args:
        converter: Shared overview converter with prefetched rates

    Returns:
        New converter instance with copied rate and failure caches
    """
    cloned_converter = FxConverter(
        provider=converter.provider,
        currency_exponents=converter.currency_exponents,
    )
    cloned_converter.rates = converter.rates.copy()
    cloned_converter.failed_rates = converter.failed_rates.copy()
    return cloned_converter
