"""Reference data every import's save loads before it writes rows"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.category import Category
from app.models.currency import Currency
from app.models.tag import Tag
from app.models.user import User
from app.schemas.import_run import TransactionImportAccountMapping, TransactionImportCategoryMapping
from app.services.importers.shared.accounts import resolve_import_account_sources
from app.services.importers.shared.categories import get_or_create_import_categories_by_source
from app.services.importers.shared.currencies import get_import_currencies_by_code
from app.services.importers.shared.merchants import ImportMerchants, load_import_merchants
from app.services.importers.shared.stats import ImportStats
from app.services.importers.shared.tags import get_personal_import_tags_by_name


@dataclass
class ImportLookups:
    """Store lookup maps used while creating imported transactions

    Attributes:
        accounts_by_source: Account rows keyed by import source
        outside_account_sources: Sources answered as money outside the tracked accounts
        categories_by_source: Category rows keyed by import source
        currencies_by_code: Currency rows keyed by currency code
        merchants: Merchant lookup for this import, holding what each payee value resolves to
        tags_by_name: Tag lookup for this import, keyed by tag name
    """

    accounts_by_source: dict[str, Account]
    outside_account_sources: set[str]
    categories_by_source: dict[str, Category]
    currencies_by_code: dict[str, Currency]
    merchants: ImportMerchants
    tags_by_name: dict[str, Tag]


async def load_import_lookups(
    db: AsyncSession,
    user: User,
    accounts: list[TransactionImportAccountMapping],
    categories: list[TransactionImportCategoryMapping],
    stats: ImportStats,
    counterparty_only_sources: set[str],
) -> ImportLookups:
    """Resolve or create every mapped account and category, then load what the rows look up

    Args:
        db: Active database session
        user: Authenticated user running the import
        accounts: Account mappings the run holds
        categories: Category mappings the run holds
        stats: Import summary counters updated while mappings are matched or created
        counterparty_only_sources: Trimmed account sources no row is written to, which resolve
            under the weaker counterparty rule

    Returns:
        Lookup maps the rows are written from
    """
    account_sources = await resolve_import_account_sources(db, user, accounts, stats, counterparty_only_sources)
    accounts_by_source = account_sources.accounts_by_source
    categories_by_source = await get_or_create_import_categories_by_source(db, user, categories, stats)

    # Load currencies after account mappings because new accounts can introduce new currency codes
    account_currency_codes = {account.currency for account in accounts_by_source.values()}
    currencies_by_code = await get_import_currencies_by_code(db, account_currency_codes)
    merchants = await load_import_merchants(db, user.id)
    tags_by_name = await get_personal_import_tags_by_name(db, user.id)

    return ImportLookups(
        accounts_by_source=accounts_by_source,
        outside_account_sources=account_sources.outside_sources,
        categories_by_source=categories_by_source,
        currencies_by_code=currencies_by_code,
        merchants=merchants,
        tags_by_name=tags_by_name,
    )
