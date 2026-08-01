"""Transaction import lookup helpers"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.models.user import User
from app.schemas.transaction import TransactionImportRequest
from app.services.importers.shared.accounts import resolve_import_account_sources
from app.services.importers.shared.categories import get_or_create_import_categories_by_source
from app.services.importers.shared.currencies import get_import_currencies_by_code
from app.services.importers.shared.merchants import get_personal_import_merchants_by_name
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import get_personal_import_tags_by_name


@dataclass
class TransactionImportLookups:
    """Store lookup maps used while creating imported transactions

    Attributes:
        accounts_by_source: Account rows keyed by import source
        outside_account_sources: Sources answered as money outside the tracked accounts
        categories_by_source: Category rows keyed by import source
        currencies_by_code: Currency rows keyed by currency code
        merchants_by_name: Request-local merchant lookup keyed by merchant name
        tags_by_name: Request-local tag lookup keyed by tag name
    """

    accounts_by_source: dict[str, Account]
    outside_account_sources: set[str]
    categories_by_source: dict[str, Category]
    currencies_by_code: dict[str, Currency]
    merchants_by_name: dict[str, Merchant]
    tags_by_name: dict[str, Tag]


async def load_transaction_import_lookups(
    db: AsyncSession,
    user: User,
    data: TransactionImportRequest,
    stats: ImportStats,
) -> TransactionImportLookups:
    """Load lookup maps needed to create imported transactions

    Args:
        db: Active database session
        user: Authenticated user running the import
        data: Prepared import payload from the frontend compiler
        stats: Import summary counters updated while mappings are matched or created

    Returns:
        Lookup maps used by the transaction import row creation helper
    """
    account_sources = await resolve_import_account_sources(db, user, data.accounts, stats)
    accounts_by_source = account_sources.accounts_by_source
    categories_by_source = await get_or_create_import_categories_by_source(db, user, data.categories, stats)

    # Load currencies after account mappings because new accounts can introduce new currency codes
    account_currency_codes = {account.currency for account in accounts_by_source.values()}
    currencies_by_code = await get_import_currencies_by_code(db, account_currency_codes)
    merchants_by_name = await get_personal_import_merchants_by_name(db, user.id)
    tags_by_name = await get_personal_import_tags_by_name(db, user.id)

    transaction_import_lookups = TransactionImportLookups(
        accounts_by_source=accounts_by_source,
        outside_account_sources=account_sources.outside_sources,
        categories_by_source=categories_by_source,
        currencies_by_code=currencies_by_code,
        merchants_by_name=merchants_by_name,
        tags_by_name=tags_by_name,
    )
    return transaction_import_lookups
