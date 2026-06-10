"""Transaction listing amount conversion"""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.transaction import Transaction
from app.services.fx import FxConverter
from app.services.fx.currency_exponent_helpers import get_currency_exponents

TransactionAmountMap = dict[uuid.UUID, int | None]


async def get_transaction_listing_converted_amounts(
    db: AsyncSession,
    transactions: list[Transaction],
    *,
    base_currency: str,
) -> tuple[TransactionAmountMap, TransactionAmountMap]:
    """Return account and base-currency amount maps for a transaction page

    The listing response exposes each transaction amount converted into both
    the owning account currency and the requesting user's base currency

    Args:
        db: Active database session
        transactions: Transactions being converted into listing response rows
        base_currency: User base currency used for converted response amounts

    Returns:
        Account-currency amounts and base-currency amounts keyed by transaction ID
    """
    accounts_by_id, currency_exponents = await _get_transaction_listing_conversion_data(
        db,
        transactions,
        extra_currencies={base_currency},
    )
    converter = FxConverter(currency_exponents=currency_exponents)
    await _prefetch_transaction_listing_amount_rates(
        converter,
        transactions=transactions,
        accounts_by_id=accounts_by_id,
        base_currency=base_currency,
    )

    account_amounts_by_transaction_id: TransactionAmountMap = {}
    base_amounts_by_transaction_id: TransactionAmountMap = {}

    # Convert every row into the two amount fields returned by the transaction listing API
    for transaction in transactions:
        account_currency = accounts_by_id[transaction.account_id].currency
        account_amounts_by_transaction_id[transaction.id] = await converter.convert_minor_units(
            transaction.amount,
            base=transaction.currency,
            quote=account_currency,
            rate_date=transaction.dt,
        )
        base_amounts_by_transaction_id[transaction.id] = await converter.convert_minor_units(
            transaction.amount,
            base=transaction.currency,
            quote=base_currency,
            rate_date=transaction.dt,
        )

    return account_amounts_by_transaction_id, base_amounts_by_transaction_id


async def _get_listing_accounts_by_id(db: AsyncSession, account_ids: set[uuid.UUID]) -> dict[uuid.UUID, Account]:
    """Return listing accounts keyed by ID

    Response conversion needs the persisted account currency for each
    transaction, so this helper batches parent account loading and returns a
    lookup map

    Args:
        db: Active database session
        account_ids: Account IDs to fetch

    Returns:
        Mapping from account ID to account row
    """
    # Fetch transaction parent accounts so account-currency conversions use persisted account currency
    account_rows = (
        (await db.execute(select(Account).where(Account.id.in_(account_ids)))).scalars().all()
        if account_ids
        else []
    )
    return {account.id: account for account in account_rows}


async def _get_transaction_listing_conversion_data(
    db: AsyncSession,
    transactions: list[Transaction],
    *,
    extra_currencies: set[str] | None = None,
) -> tuple[dict[uuid.UUID, Account], dict[str, int]]:
    """Return account and currency data for listing amount conversion

    Args:
        db: Active database session
        transactions: Transactions being converted into listing response rows
        extra_currencies: Additional currency codes required by the conversion data

    Returns:
        Account rows keyed by ID and currency exponents keyed by currency code
    """
    accounts_by_id = await _get_listing_accounts_by_id(db, {transaction.account_id for transaction in transactions})

    # Include original transaction currencies and account currencies because listing converts both directions
    transaction_currencies = {
        transaction.currency
        for transaction in transactions
    }
    account_currencies = {
        account.currency
        for account in accounts_by_id.values()
    }

    # Add caller-provided currencies such as the user's base currency for response fields
    currencies = set(transaction_currencies)
    currencies.update(account_currencies)
    if extra_currencies:
        currencies.update(extra_currencies)

    return accounts_by_id, await get_currency_exponents(db, currencies)


async def _prefetch_transaction_listing_amount_rates(
    converter: FxConverter,
    *,
    transactions: list[Transaction],
    accounts_by_id: dict[uuid.UUID, Account],
    base_currency: str,
) -> None:
    """Prefetch exchange rates needed to build listing amount fields

    Args:
        converter: Request-scoped FX converter that caches prefetched rates
        transactions: Transactions being converted into listing response rows
        accounts_by_id: Account rows keyed by ID
        base_currency: User base currency used for converted response amounts

    Returns:
        None
    """
    if not transactions:
        return

    start_date = min(transaction.dt for transaction in transactions)
    end_date = max(transaction.dt for transaction in transactions)

    # Collapse repeated conversions into distinct currency pairs before prefetching rates
    conversion_pairs = {
        (transaction.currency, quote_currency)
        for transaction in transactions
        for quote_currency in (accounts_by_id[transaction.account_id].currency, base_currency)
        if transaction.currency != quote_currency
    }
    for base_currency_code, quote_currency_code in sorted(conversion_pairs):
        await converter.prefetch_rates(
            base=base_currency_code,
            quote=quote_currency_code,
            start_date=start_date,
            end_date=end_date,
        )
