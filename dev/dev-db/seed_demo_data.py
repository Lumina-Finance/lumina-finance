"""Seed the development database with realistic demo data

Creates two demo users with a trailing year of
transactions, budgets, and balance history. All dates are generated relative
to the run date so dashboards, active budget periods, and trends always have
current data no matter when the script runs. Demo people and merchants are
fictional while institutions are real Canadian ones

Existing rows for the demo users are deleted and regenerated on every run.
Reference data (currencies, system categories) and any other users' data are
left untouched

This script is development tooling and lives outside the backend package so
it never ships with the app. Run it through the make target, which seeds the
reference data first and supplies the backend interpreter and import path:
    make seed-dev-data
"""

import asyncio
import calendar
import random
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, or_, select

from app.database import create_migration_sessionmaker
from app.models.account import (
    Account,
    AccountBalanceSnapshot,
    TaxAdvantagedCategory,
    TaxAdvantagedCategoryLimit,
)
from app.models.auth import AuthIdentity, PasswordCredential, TotpCredential
from app.models.base import (
    ACCOUNT_KIND_BY_TYPE,
    AccountType,
    AuthProvider,
    CategoryKind,
    InstitutionStatus,
    RecurrenceFreq,
    TaxTreatment,
)
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.cache_state import UserCacheState
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group
from app.models.institution import Institution
from app.models.merchant import Merchant
from app.models.saved_insights_range import SavedInsightsRange
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User, UserRunwayAccount
from app.services.auth.password_helpers import hash_password
from app.services.budgets.periods import compute_period_end

PASSWORD = "password"  # noqa: S105
DEMO_USER_EMAILS = ("alice@example.com", "marco@example.com")
RNG_SEED = 42
WINDOW_MONTHS = 24

# Utility bills hover inside a band per season instead of sliding month to
# month, with winter heating the most expensive and summer the cheapest
UTILITY_SEASON_BANDS = (
    ((12, 1, 2), (1.35, 1.50)),
    ((3, 4, 5), (1.00, 1.15)),
    ((6, 7, 8), (0.80, 0.90)),
    ((9, 10, 11), (1.00, 1.15)),
)
UTILITY_FACTOR_RANGE_BY_MONTH = {
    month: band for months, band in UTILITY_SEASON_BANDS for month in months
}

# December discretionary spending runs hotter than the rest of the year
HOLIDAY_SPIKE_MONTH = 12
HOLIDAY_SHOPPING_FACTOR = 1.8

# Mild upward price drift across the window so month-over-month trends slope
ANNUAL_DRIFT = 0.025

# Workday market move parameters give investment balances a gentle upward
# drift with realistic daily noise
DAILY_MARKET_DRIFT = 0.0004
DAILY_MARKET_VOLATILITY = 0.009

# Quarterly dividend yield and occasional realized gains for investment
# accounts, gains only because the demo story keeps realizations positive
QUARTERLY_DIVIDEND_YIELD_RANGE = (0.005, 0.007)
CAPITAL_GAIN_RANGE = (0.01, 0.04)
CAPITAL_GAINS_PER_YEAR = 3

TODAY = date.today()

_window_anchor_months = TODAY.year * 12 + TODAY.month - 1 - (WINDOW_MONTHS - 1)
WINDOW_START = date(_window_anchor_months // 12, _window_anchor_months % 12 + 1, 1)

rng = random.Random(RNG_SEED)  # noqa: S311


def _add_months(day: date, months: int) -> date:
    """Return the date shifted by whole months with the day clamped to month length"""
    total_months = day.year * 12 + day.month - 1 + months
    year, month = total_months // 12, total_months % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def _month_index(day: date) -> int:
    """Return how many whole months the date sits past the window start"""
    return (day.year - WINDOW_START.year) * 12 + day.month - WINDOW_START.month


def _month_starts() -> list[date]:
    """Return the first day of every month in the window up to today"""
    return [_add_months(WINDOW_START, i) for i in range(WINDOW_MONTHS)]


def _monthly_dates(dom: int) -> list[date]:
    """Return one date per window month on the given day of month, capped at today"""
    dates = []
    for month_start in _month_starts():
        last_day = calendar.monthrange(month_start.year, month_start.month)[1]
        day = month_start.replace(day=min(dom, last_day))
        if day <= TODAY:
            dates.append(day)
    return dates


def _weekly_dates(weekday: int) -> list[date]:
    """Return every occurrence of the weekday between the window start and today"""
    day = WINDOW_START
    while day.weekday() != weekday:
        day += timedelta(days=1)
    dates = []
    while day <= TODAY:
        dates.append(day)
        day += timedelta(days=7)
    return dates


def _random_days(month_start: date, count: int) -> list[date]:
    """Return sorted random dates within one month, capped at today"""
    last_day = calendar.monthrange(month_start.year, month_start.month)[1]
    days = rng.sample(range(1, last_day + 1), min(count, last_day))
    return sorted(
        month_start.replace(day=day)
        for day in days
        if month_start.replace(day=day) <= TODAY
    )


def _seasonal_utility_amount(base: int, day: date) -> int:
    """Return a utility charge landing inside the date's seasonal band"""
    low, high = UTILITY_FACTOR_RANGE_BY_MONTH[day.month]
    return round(base * rng.uniform(low, high))


def _drift(day: date) -> float:
    """Return the cumulative price drift multiplier for a date in the window"""
    return 1 + ANNUAL_DRIFT * _month_index(day) / 12


def _vary(base: int, day: date, spread: float = 0.15) -> int:
    """Return the base amount with random variation and price drift applied"""
    return round(base * rng.uniform(1 - spread, 1 + spread) * _drift(day))


def _txn(user_id, account, day, merchant, category, amount, *, currency=None, fx_rate=None, notes=None):
    """Build a Transaction row in the account currency unless one is given"""
    return Transaction(
        created_by_user_id=user_id,
        account_id=account.id,
        dt=day,
        merchant_id=merchant.id if merchant is not None else None,
        category_id=category.id,
        amount=amount,
        currency=currency or account.currency,
        fx_rate=fx_rate,
        notes=notes,
    )


async def _delete_demo_data(db) -> None:
    """Delete every row belonging to the demo users so reruns start clean

    Deletes follow dependency order because several foreign keys do not
    cascade. Reference data and other users' rows are never touched
    """
    demo_users = select(User.id).where(User.email.in_(DEMO_USER_EMAILS)).scalar_subquery()
    demo_groups = select(Group.id).where(Group.owner_id.in_(demo_users)).scalar_subquery()
    demo_accounts = (
        select(Account.id)
        .where(or_(Account.owner_id.in_(demo_users), Account.group_id.in_(demo_groups)))
        .scalar_subquery()
    )
    demo_transactions = (
        select(Transaction.id).where(Transaction.account_id.in_(demo_accounts)).scalar_subquery()
    )

    # Transaction tags block the account cascade because their foreign key has no delete rule
    await db.execute(delete(TransactionTag).where(TransactionTag.transaction_id.in_(demo_transactions)))

    # Base budgets cascade to instances, tracked categories, and budget permissions
    await db.execute(delete(BaseBudget).where(
        or_(BaseBudget.owner_id.in_(demo_users), BaseBudget.group_id.in_(demo_groups)),
    ))

    # Accounts cascade to transactions, snapshots, and account permissions
    await db.execute(delete(Account).where(
        or_(Account.owner_id.in_(demo_users), Account.group_id.in_(demo_groups)),
    ))

    # Merchants must go before categories because default_category_id has no delete rule
    await db.execute(delete(Merchant).where(
        or_(Merchant.owner_id.in_(demo_users), Merchant.group_id.in_(demo_groups)),
    ))
    await db.execute(delete(Category).where(
        Category.is_system.is_(False),
        or_(Category.owner_id.in_(demo_users), Category.group_id.in_(demo_groups)),
    ))
    await db.execute(delete(Tag).where(
        or_(Tag.owner_id.in_(demo_users), Tag.group_id.in_(demo_groups)),
    ))
    await db.execute(delete(TaxAdvantagedCategory).where(
        TaxAdvantagedCategory.category_owner_user_id.in_(demo_users),
    ))

    # Groups cascade to memberships and group cache states
    await db.execute(delete(Group).where(Group.owner_id.in_(demo_users)))

    # Credential tables whose user foreign keys have no delete rule
    await db.execute(delete(AuthIdentity).where(AuthIdentity.user_id.in_(demo_users)))
    await db.execute(delete(PasswordCredential).where(PasswordCredential.user_id.in_(demo_users)))
    await db.execute(delete(TotpCredential).where(TotpCredential.user_id.in_(demo_users)))

    # Remaining per-user rows (sessions, tokens, runway picks, saved ranges,
    # cache state, recovery and reset artifacts) cascade from the user rows
    await db.execute(delete(User).where(User.email.in_(DEMO_USER_EMAILS)))


async def _load_reference_data(db):
    """Load currencies and system categories, failing loudly when they are missing"""
    currency_ids = set(
        (await db.execute(select(Currency.id).where(Currency.id.in_(("CAD", "USD"))))).scalars(),
    )
    missing_currencies = {"CAD", "USD"} - currency_ids
    if missing_currencies:
        msg = f"Missing currencies {sorted(missing_currencies)}, run scripts.seed_currencies first"
        raise RuntimeError(msg)

    system_categories = {
        category.name: category
        for category in (
            await db.execute(select(Category).where(Category.is_system.is_(True)))
        ).scalars()
    }
    required = {
        "Groceries", "Dining", "Takeout", "Public Transit", "Ride Hailing", "Fuel",
        "Entertainment", "Shopping", "Electronics", "Personal Care", "Health", "Hobby",
        "Rent", "Electricity", "Water", "Propane/LNG", "Internet", "Phone Plan", "Insurance",
        "Travel", "Salary", "Freelance", "Interest", "Dividends", "Capital Gains",
        "Transfer", "Credit Card Payment", "Balance Adjustment", "Home Improvement",
    }
    missing_categories = required - set(system_categories)
    if missing_categories:
        msg = f"Missing system categories {sorted(missing_categories)}, run scripts.seed_categories first"
        raise RuntimeError(msg)
    return system_categories


async def _seed_institutions(db):
    """Insert the real Canadian institutions the demo accounts use, reusing rows that already exist"""
    wanted = [
        ("Toronto Dominion Bank", "CA", "https://td.com"),
        ("Vancity", "CA", "https://vancity.com"),
        ("Royal Bank of Canada", "CA", "https://rbc.com"),
    ]
    institutions = {}
    for name, country_code, website in wanted:
        existing = (await db.execute(select(Institution).where(
            Institution.name == name, Institution.country_code == country_code,
        ))).scalar_one_or_none()
        if existing is None:
            existing = Institution(
                status=InstitutionStatus.CANONICAL,
                name=name, country_code=country_code, website=website,
            )
            db.add(existing)
        institutions[name] = existing
    await db.flush()
    return institutions


async def _seed_users(db):
    """Create the demo users with password credentials and cache state rows"""
    created_at = datetime.combine(WINDOW_START, datetime.min.time(), tzinfo=UTC)
    alice = User(
        email="alice@example.com", first_name="Alice", last_name="Chen",
        tz="America/Toronto", base_currency="CAD", created_at=created_at,
    )
    marco = User(
        email="marco@example.com", first_name="Marco", last_name="Moretti",
        tz="America/Vancouver", base_currency="CAD", created_at=created_at,
    )
    db.add_all([alice, marco])
    await db.flush()

    password_hash = hash_password(PASSWORD)
    for user in (alice, marco):
        db.add(AuthIdentity(
            user_id=user.id, auth_provider=AuthProvider.PASSWORD,
            email_verified=True, email_verified_at=created_at,
        ))
        db.add(PasswordCredential(
            user_id=user.id, password_hash=password_hash,
            password_algo="argon2id",  # noqa: S106
        ))
        db.add(UserCacheState(user_id=user.id))
    await db.flush()
    return {"alice": alice, "marco": marco}


async def _seed_categories(db, users, system_categories):
    """Create custom personal categories alongside the system set

    Demo transactions mostly use system categories because signup no longer
    copies a personal set, so custom categories exist only to exercise the
    custom-category surfaces in the app. Group transactions use system
    categories too because the app never lists group-scoped categories, so
    seeding them would render as unresolvable ids in every picker and label
    """
    categories = {
        "system": system_categories,
        "alice": {
            "Pottery Studio": Category(
                owner_id=users["alice"].id, name="Pottery Studio",
                kind=CategoryKind.EXPENSE, icon="🏺",
            ),
        },
        "marco": {
            "Climbing Gym": Category(
                owner_id=users["marco"].id, name="Climbing Gym",
                kind=CategoryKind.EXPENSE, icon="🧗",
            ),
        },
    }
    db.add_all([*categories["alice"].values(), *categories["marco"].values()])
    await db.flush()
    return categories


async def _seed_merchants(db, users, categories):
    """Create fictional personal merchants with default categories"""
    system = categories["system"]
    alice, marco = users["alice"], users["marco"]

    def merchant(owner, name, default_category):
        return Merchant(
            owner_id=owner.id,
            name=name,
            default_category_id=default_category.id if default_category is not None else None,
        )

    merchants = {
        "alice": {
            name: merchant(alice, name, default)
            for name, default in [
                ("Brightline Studios", system["Salary"]),
                ("Fern Street Market", system["Groceries"]),
                ("Golden Pantry", system["Groceries"]),
                ("Noodle Junction", system["Dining"]),
                ("Delivery Dash", system["Takeout"]),
                ("City Transit", system["Public Transit"]),
                ("Streamora", system["Entertainment"]),
                ("Melodine", system["Entertainment"]),
                ("Ironworks Gym", system["Health"]),
                ("Shopporium", system["Shopping"]),
                ("Wellness Corner Pharmacy", system["Personal Care"]),
                ("Parkside Property Management", system["Rent"]),
                ("City Hydro", system["Electricity"]),
                ("City Water", system["Water"]),
                ("Nova Mobile", system["Phone Plan"]),
                ("Skyline Internet", system["Internet"]),
                ("Clay & Kiln Studio", categories["alice"]["Pottery Studio"]),
                ("Harbour Inn", system["Travel"]),
            ]
        },
        "marco": {
            name: merchant(marco, name, default)
            for name, default in [
                ("Campus Bookstore", system["Salary"]),
                ("Harvest Market", system["Groceries"]),
                ("Bean & Brew", system["Dining"]),
                ("Bargain Bin", system["Shopping"]),
                ("Pixel Arcade", system["Entertainment"]),
                ("Summit Climbing Co", categories["marco"]["Climbing Gym"]),
                ("Nova Mobile", system["Phone Plan"]),
                ("Landlord - 45 King", system["Rent"]),
                ("West Coast Hydro", system["Electricity"]),
            ]
        },
    }
    db.add_all([m for scope in merchants.values() for m in scope.values()])
    await db.flush()
    return merchants


async def _seed_tags(db, users):
    """Create personal tags used to label recurring and trip spending"""
    tags = {
        "alice": Tag(owner_id=users["alice"].id, name="recurring"),
        "alice_vacation": Tag(owner_id=users["alice"].id, name="vacation"),
        "marco": Tag(owner_id=users["marco"].id, name="recurring"),
    }
    db.add_all(tags.values())
    await db.flush()
    return tags


async def _seed_tax_advantaged_categories(db, users):
    """Create the TFSA and RRSP tax-advantaged categories with per-year limits

    Accrued totals start at a plausible pre-window base and are topped up after
    transaction generation so stored accruals match the generated transfers
    """
    # Lifetime TFSA room matches the cumulative federal limit for someone
    # eligible since 2009, and the base accruals represent pre-window savings
    tfsa = TaxAdvantagedCategory(
        category_owner_user_id=users["alice"].id, name="TFSA",
        tax_treatment=TaxTreatment.TAX_FREE, currency="CAD",
        lifetime_contribution_limit=10_200_000, accrued_contributions=2_000_000,
    )
    rrsp = TaxAdvantagedCategory(
        category_owner_user_id=users["alice"].id, name="RRSP",
        tax_treatment=TaxTreatment.TAX_DEFERRED, currency="CAD",
        lifetime_contribution_limit=None, accrued_contributions=900_000,
    )

    # The FHSA carries the federal forty thousand dollar lifetime cap
    fhsa = TaxAdvantagedCategory(
        category_owner_user_id=users["alice"].id, name="FHSA",
        tax_treatment=TaxTreatment.TAX_FREE, currency="CAD",
        lifetime_contribution_limit=4_000_000, accrued_contributions=550_000,
    )
    db.add_all([tfsa, rrsp, fhsa])
    await db.flush()

    # The TFSA annual limit is the federal one, while the RRSP limit is 18
    # percent of the seeded salary rather than the statutory maximum, matching
    # how personal RRSP room actually works
    limits = {}
    for year in range(WINDOW_START.year, TODAY.year + 1):
        limits[("tfsa", year)] = TaxAdvantagedCategoryLimit(
            tax_advantaged_category_id=tfsa.id, year=year,
            contribution_limit=700_000, withdrawal_limit=None,
        )
        limits[("rrsp", year)] = TaxAdvantagedCategoryLimit(
            tax_advantaged_category_id=rrsp.id, year=year,
            contribution_limit=1_080_000, withdrawal_limit=None,
        )

        # The FHSA annual limit is the federal eight thousand dollars
        limits[("fhsa", year)] = TaxAdvantagedCategoryLimit(
            tax_advantaged_category_id=fhsa.id, year=year,
            contribution_limit=800_000, withdrawal_limit=None,
        )
    db.add_all(limits.values())
    await db.flush()
    return {"tfsa": tfsa, "rrsp": rrsp, "fhsa": fhsa, "limits": limits}


async def _seed_accounts(db, users, institutions, tax_advantaged):
    """Create the demo users' personal accounts"""
    alice, marco = users["alice"], users["marco"]
    created_at = datetime.combine(WINDOW_START, datetime.min.time().replace(hour=12), tzinfo=UTC)

    def account(name, account_type, *, owner, institution=None,
                tax_advantaged_category=None, credit_limit=None, currency="CAD"):
        return Account(
            owner_id=owner.id,
            account_kind=ACCOUNT_KIND_BY_TYPE[account_type],
            account_type=account_type,
            tax_advantaged_category_id=(
                tax_advantaged_category.id if tax_advantaged_category is not None else None
            ),
            name=name,
            institution_id=institution.id if institution is not None else None,
            currency=currency,
            credit_limit=credit_limit,
            created_at=created_at,
        )

    accounts = {
        "alice_chequing": account(
            "Everyday Chequing", AccountType.CHECKING,
            owner=alice, institution=institutions["Toronto Dominion Bank"],
        ),
        "alice_savings": account(
            "High-Interest Savings", AccountType.SAVINGS,
            owner=alice, institution=institutions["Toronto Dominion Bank"],
        ),
        "alice_old_savings": account(
            "Vacation Fund", AccountType.SAVINGS,
            owner=alice, institution=institutions["Toronto Dominion Bank"],
        ),
        "alice_tfsa": account(
            "TFSA Investments", AccountType.INVESTMENT,
            owner=alice, institution=institutions["Royal Bank of Canada"],
            tax_advantaged_category=tax_advantaged["tfsa"],
        ),
        "alice_rrsp": account(
            "RRSP Investments", AccountType.INVESTMENT,
            owner=alice, institution=institutions["Royal Bank of Canada"],
            tax_advantaged_category=tax_advantaged["rrsp"],
        ),
        "alice_fhsa": account(
            "FHSA Savings", AccountType.SAVINGS,
            owner=alice, institution=institutions["Royal Bank of Canada"],
            tax_advantaged_category=tax_advantaged["fhsa"],
        ),
        "alice_usd": account(
            "US Dollar Chequing", AccountType.CHECKING,
            owner=alice, institution=institutions["Toronto Dominion Bank"], currency="USD",
        ),
        "alice_card": account(
            "Platinum Rewards Card", AccountType.CREDIT_CARD,
            owner=alice, institution=institutions["Toronto Dominion Bank"], credit_limit=800_000,
        ),
        "marco_chequing": account(
            "Student Chequing", AccountType.CHECKING,
            owner=marco, institution=institutions["Vancity"],
        ),
        "marco_savings": account(
            "Rainy Day Savings", AccountType.SAVINGS,
            owner=marco, institution=institutions["Vancity"],
        ),
        "marco_cash": account("Cash Wallet", AccountType.CASH, owner=marco),
    }
    db.add_all(accounts.values())
    await db.flush()
    return accounts


def _starting_balance_transactions(users, accounts, system):
    """Build the starting-balance adjustments that open each account's history"""
    alice, marco = users["alice"], users["marco"]
    adjustment = system["Balance Adjustment"]

    # Investment openings stay a modest share of each person's assets so the
    # volatile portion of net worth remains realistic for these income levels
    openings = [
        (alice, accounts["alice_chequing"], 300_000),
        (alice, accounts["alice_savings"], 2_500_000),
        (alice, accounts["alice_old_savings"], 400_000),
        (alice, accounts["alice_tfsa"], 800_000),
        (alice, accounts["alice_rrsp"], 400_000),
        (alice, accounts["alice_fhsa"], 600_000),
        (alice, accounts["alice_usd"], 40_000),
        (marco, accounts["marco_chequing"], 200_000),
        (marco, accounts["marco_savings"], 500_000),
        (marco, accounts["marco_cash"], 20_000),
    ]
    return [
        _txn(user.id, account, WINDOW_START, None, adjustment, amount, notes="Starting balance")
        for user, account, amount in openings
    ]


def _alice_transactions(users, accounts, categories, merchants, tags, contributions):
    """Build Alice's year of personal activity"""
    alice = users["alice"]
    system, am = categories["system"], merchants["alice"]
    chequing, card = accounts["alice_chequing"], accounts["alice_card"]
    usd_chequing = accounts["alice_usd"]
    savings = accounts["alice_savings"]
    tfsa, rrsp, fhsa = accounts["alice_tfsa"], accounts["alice_rrsp"], accounts["alice_fhsa"]
    old_savings = accounts["alice_old_savings"]
    txns, tag_pairs = [], []

    def add(txn, tag=None):
        txns.append(txn)
        if tag is not None:
            tag_pairs.append((txn, tag.id))

    # Monthly salary on the first workday of each month with a raise partway through
    for month_start in _month_starts():
        payday = _next_workday(month_start)
        if payday > TODAY:
            continue
        base = 500_000 if _month_index(payday) < WINDOW_MONTHS // 2 else 522_000
        add(
            _txn(alice.id, chequing, payday, am["Brightline Studios"], system["Salary"], base,
                 notes="Monthly salary"),
            tags["alice"],
        )

    # Rent on the first of each month
    for day in _monthly_dates(1):
        add(
            _txn(alice.id, chequing, day, am["Parkside Property Management"], system["Rent"],
                 -165_000, notes="Monthly rent"),
            tags["alice"],
        )

    # Seasonal hydro bill
    for day in _monthly_dates(16):
        add(
            _txn(alice.id, chequing, day, am["City Hydro"], system["Electricity"],
                 -_seasonal_utility_amount(12_000, day)),
            tags["alice"],
        )

    # Water bill, a flat rate so utility costs move only with the seasons
    for day in _monthly_dates(19):
        add(
            _txn(alice.id, chequing, day, am["City Water"], system["Water"], -3_500),
            tags["alice"],
        )

    # Fixed recurring bills and subscriptions
    for dom, merchant, category, base in [
        (2, am["City Transit"], system["Public Transit"], -15_600),
        (5, am["Ironworks Gym"], system["Health"], -5_000),
        (8, am["Nova Mobile"], system["Phone Plan"], -4_500),
        (8, am["Skyline Internet"], system["Internet"], -6_500),
        (10, am["Streamora"], system["Entertainment"], -1_649),
        (12, am["Melodine"], system["Entertainment"], -1_099),
        (15, am["Clay & Kiln Studio"], categories["alice"]["Pottery Studio"], -8_000),
    ]:
        for day in _monthly_dates(dom):
            add(_txn(alice.id, card, day, merchant, category, base), tags["alice"])

    # Weekly Saturday grocery runs on the card
    for day in _weekly_dates(5):
        merchant = rng.choice([am["Fern Street Market"], am["Golden Pantry"]])
        add(_txn(alice.id, card, day, merchant, system["Groceries"], -_vary(11_500, day)))

    # Dining and takeout a few times a month
    for month_start in _month_starts():
        for day in _random_days(month_start, 5):
            if rng.random() < 0.4:
                add(_txn(alice.id, card, day, am["Delivery Dash"], system["Takeout"], -_vary(4_200, day)))
            else:
                add(_txn(alice.id, card, day, am["Noodle Junction"], system["Dining"], -_vary(6_000, day)))

    # Shopping with a December holiday spike
    for month_start in _month_starts():
        count = 5 if month_start.month == HOLIDAY_SPIKE_MONTH else 3
        factor = HOLIDAY_SHOPPING_FACTOR if month_start.month == HOLIDAY_SPIKE_MONTH else 1.0
        for day in _random_days(month_start, count):
            merchant = rng.choice([am["Shopporium"], am["Wellness Corner Pharmacy"]])
            category = system["Shopping"] if merchant.name == "Shopporium" else system["Personal Care"]
            add(_txn(alice.id, card, day, merchant, category, -round(_vary(7_500, day) * factor)))

    # Occasional ride hailing without a saved merchant
    for month_start in _month_starts():
        for day in _random_days(month_start, 2):
            add(_txn(alice.id, card, day, None, system["Ride Hailing"], -_vary(2_200, day), notes="Ride home"))

    # Monthly deposit into the high-interest savings cushion, both legs
    for day in _monthly_dates(12):
        add(_txn(alice.id, chequing, day, None, system["Transfer"], -30_000, notes="Savings deposit"))
        add(_txn(alice.id, savings, day, None, system["Transfer"], 30_000, notes="From chequing"))

    # Quarterly savings interest
    for month_start in _month_starts()[2::3]:
        day = month_start.replace(day=28)
        if day <= TODAY:
            add(_txn(alice.id, savings, day, None, system["Interest"], _vary(1_400, day), notes="Quarterly interest"))

    # Monthly TFSA contribution, both transfer legs
    for day in _monthly_dates(20):
        add(_txn(alice.id, chequing, day, None, system["Transfer"], -40_000, notes="TFSA contribution"))
        add(_txn(alice.id, tfsa, day, None, system["Transfer"], 40_000, notes="Contribution from chequing"))
        contributions["tfsa"][day.year] += 40_000

    # Monthly RRSP contribution, both transfer legs
    for day in _monthly_dates(25):
        add(_txn(alice.id, chequing, day, None, system["Transfer"], -25_000, notes="RRSP contribution"))
        add(_txn(alice.id, rrsp, day, None, system["Transfer"], 25_000, notes="Contribution from chequing"))
        contributions["rrsp"][day.year] += 25_000

    # Monthly FHSA contribution, both transfer legs
    for day in _monthly_dates(22):
        add(_txn(alice.id, chequing, day, None, system["Transfer"], -30_000, notes="FHSA contribution"))
        add(_txn(alice.id, fhsa, day, None, system["Transfer"], 30_000, notes="Contribution from chequing"))
        contributions["fhsa"][day.year] += 30_000

    # Quarterly FHSA savings interest
    for month_start in _month_starts()[2::3]:
        day = month_start.replace(day=28)
        if day <= TODAY:
            add(_txn(alice.id, fhsa, day, None, system["Interest"], _vary(600, day), notes="Quarterly interest"))

    # The vacation fund drains into chequing for six months, then archives
    for day in _monthly_dates(5)[:6]:
        add(_txn(alice.id, old_savings, day, None, system["Transfer"], -60_000, notes="Move savings to chequing"))
        add(_txn(alice.id, chequing, day, None, system["Transfer"], 60_000, notes="From vacation fund"))

    # One week-long trip four months ago paid in US dollars on the card
    trip_month = _add_months(TODAY.replace(day=1), -4)
    trip_start = trip_month.replace(day=10)
    for offset, merchant, category, amount in [
        (0, am["Harbour Inn"], system["Travel"], -68_000),
        (2, None, system["Dining"], -9_500),
        (4, None, system["Travel"], -12_000),
    ]:
        day = trip_start + timedelta(days=offset)
        add(
            _txn(alice.id, card, day, merchant, category, amount,
                 currency="USD", fx_rate=1.36, notes="Trip to Seattle"),
            tags["alice_vacation"],
        )

    # The US dollar account is topped up before the trip and spent from
    # directly in its own currency, so the two transfer legs carry the
    # exchange rate implicitly through their differing amounts
    funding_day = trip_month.replace(day=3)
    add(_txn(alice.id, chequing, funding_day, None, system["Transfer"], -136_000,
             notes="USD purchase for trip"))
    add(_txn(alice.id, usd_chequing, funding_day, None, system["Transfer"], 100_000,
             notes="Funded from chequing"))
    for offset, category, amount in [(1, system["Dining"], -9_500), (3, system["Shopping"], -7_200)]:
        add(
            _txn(alice.id, usd_chequing, trip_start + timedelta(days=offset), None, category, amount,
                 notes="Trip to Seattle"),
            tags["alice_vacation"],
        )

    # A weekend getaway this month backs the one-off budget, with the first
    # charge pinned to the first of the month so the budget always shows
    # utilization no matter how early in the month the seed runs
    getaway_days = [TODAY.replace(day=1)]
    if TODAY.day > 1:
        getaway_days.append(TODAY.replace(day=rng.randint(2, TODAY.day)))
    for day in getaway_days:
        add(_txn(alice.id, card, day, None, system["Travel"], -_vary(14_000, day), notes="Weekend getaway"))

    return txns, tag_pairs


def _marco_transactions(users, accounts, categories, merchants, tags):
    """Build Marco's year of personal activity"""
    marco = users["marco"]
    system, bm = categories["system"], merchants["marco"]
    chequing, savings, cash = (
        accounts["marco_chequing"], accounts["marco_savings"], accounts["marco_cash"],
    )
    txns, tag_pairs = [], []

    def add(txn, tag=None):
        txns.append(txn)
        if tag is not None:
            tag_pairs.append((txn, tag.id))

    # Weekly part-time pay every Friday
    for payday in _weekly_dates(4):
        add(
            _txn(marco.id, chequing, payday, bm["Campus Bookstore"], system["Salary"], 45_000,
                 notes="Weekly pay"),
            tags["marco"],
        )

    # Rent on the first of each month
    for day in _monthly_dates(1):
        add(
            _txn(marco.id, chequing, day, bm["Landlord - 45 King"], system["Rent"], -95_000,
                 notes="Monthly rent"),
            tags["marco"],
        )

    # Seasonal hydro bill
    for day in _monthly_dates(20):
        add(
            _txn(marco.id, chequing, day, bm["West Coast Hydro"], system["Electricity"],
                 -_seasonal_utility_amount(8_000, day)),
            tags["marco"],
        )

    # Fixed recurring bills
    for dom, merchant, category, base in [
        (7, bm["Nova Mobile"], system["Phone Plan"], -3_500),
        (11, bm["Summit Climbing Co"], categories["marco"]["Climbing Gym"], -7_500),
    ]:
        for day in _monthly_dates(dom):
            add(_txn(marco.id, chequing, day, merchant, category, base), tags["marco"])

    # Monthly cash withdrawal keeps the wallet funded for cash grocery runs
    for day in _monthly_dates(1):
        add(_txn(marco.id, chequing, day, None, system["Transfer"], -10_000, notes="Cash withdrawal"))
        add(_txn(marco.id, cash, day, None, system["Transfer"], 10_000, notes="ATM withdrawal"))

    # Weekly Thursday groceries, paid in cash about a quarter of the time
    for day in _weekly_dates(3):
        account = cash if rng.random() < 0.25 else chequing
        add(_txn(marco.id, account, day, bm["Harvest Market"], system["Groceries"], -_vary(8_000, day)))

    # Cafe visits several times a month
    for month_start in _month_starts():
        for day in _random_days(month_start, 5):
            add(_txn(marco.id, chequing, day, bm["Bean & Brew"], system["Dining"], -_vary(650, day, 0.3)))

    # An arcade night roughly once a month
    for month_start in _month_starts():
        for day in _random_days(month_start, 1):
            add(_txn(marco.id, chequing, day, bm["Pixel Arcade"], system["Entertainment"], -_vary(2_500, day)))

    # Thrift shopping about twice a month
    for month_start in _month_starts():
        for day in _random_days(month_start, 2):
            add(_txn(marco.id, chequing, day, bm["Bargain Bin"], system["Shopping"], -_vary(2_500, day)))

    # Monthly transfer into savings, both legs
    for day in _monthly_dates(15):
        amount = _vary(20_000, day, 0.2)
        add(_txn(marco.id, chequing, day, None, system["Transfer"], -amount, notes="Savings transfer"))
        add(_txn(marco.id, savings, day, None, system["Transfer"], amount, notes="From chequing"))

    # Quarterly savings interest
    for month_start in _month_starts()[2::3]:
        day = month_start.replace(day=28)
        if day <= TODAY:
            add(_txn(marco.id, savings, day, None, system["Interest"], _vary(650, day), notes="Quarterly interest"))

    return txns, tag_pairs


def _archive_old_savings(users, accounts, categories, txns):
    """Archive Alice's drained vacation fund by zeroing its residual balance

    Mirrors the app's archive flow, which books a balance adjustment for the
    remaining balance and stamps the account archived
    """
    alice = users["alice"]
    account = accounts["alice_old_savings"]
    archive_day = _add_months(WINDOW_START, 6).replace(day=15)
    residual = sum(t.amount for t in txns if t.account_id == account.id)
    archive_txn = _txn(
        alice.id, account, archive_day, None, categories["system"]["Balance Adjustment"],
        -residual, notes="Account archived",
    )
    account.is_archived = True
    account.closed_at = datetime.combine(archive_day, datetime.min.time().replace(hour=12), tzinfo=UTC)
    return [archive_txn]


def _previous_workday(day: date) -> date:
    """Return the date itself or the preceding Friday when it falls on a weekend"""
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day


def _next_workday(day: date) -> date:
    """Return the date itself or the following Monday when it falls on a weekend"""
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def _investment_activity(users, accounts, categories, txns):
    """Build workday market moves, quarterly dividends, and occasional gains

    Proportional daily adjustments with a slight upward bias make investment
    balances wiggle like real portfolios, dividends arrive quarterly, and a
    few realized capital gains land through the year. Weekends are skipped
    because markets are closed, and every amount is sized against the balance
    the account actually holds that day
    """
    system = categories["system"]
    holdings = [
        (users["alice"], accounts["alice_tfsa"]),
        (users["alice"], accounts["alice_rrsp"]),
    ]

    # Dividends pay mid-month at the end of each quarter of the window
    dividend_days = {
        _previous_workday(month_start.replace(day=15))
        for month_start in _month_starts()[2::3]
    }

    activity = []
    for user, account in holdings:
        deltas = defaultdict(int)
        for txn in txns:
            if txn.account_id == account.id:
                deltas[txn.dt] += txn.amount

        gain_days = {
            _previous_workday(month_start.replace(day=rng.randint(1, 28)))
            for month_start in rng.sample(_month_starts(), CAPITAL_GAINS_PER_YEAR * WINDOW_MONTHS // 12)
        }

        # Walk the window with a running balance so each move is proportional
        # to what the account actually holds that day
        balance = 0
        day = WINDOW_START
        while day <= TODAY:
            balance += deltas[day]
            if day.weekday() < 5 and balance > 0:
                if day in dividend_days:
                    dividend = round(balance * rng.uniform(*QUARTERLY_DIVIDEND_YIELD_RANGE))
                    activity.append(
                        _txn(user.id, account, day, None, system["Dividends"], dividend, notes="Quarterly dividend"),
                    )
                    balance += dividend
                if day in gain_days:
                    gain = round(balance * rng.uniform(*CAPITAL_GAIN_RANGE))
                    activity.append(
                        _txn(user.id, account, day, None, system["Capital Gains"], gain, notes="Realized gain"),
                    )
                    balance += gain
                move = round(balance * rng.gauss(DAILY_MARKET_DRIFT, DAILY_MARKET_VOLATILITY))
                if move != 0:
                    activity.append(
                        _txn(user.id, account, day, None, system["Balance Adjustment"], move, notes="Market value change"),
                    )
                    balance += move
            day += timedelta(days=1)
    return activity


def _credit_card_payments(users, accounts, categories, txns):
    """Build monthly card payments that settle the previous month's card spend

    Ties each payment to the actual statement balance so card balances stay
    bounded and the payment amounts look like a real autopay setup
    """
    system = categories["system"]
    cards = [
        (users["alice"], accounts["alice_chequing"], accounts["alice_card"]),
    ]
    payments = []
    for user, chequing, card in cards:
        spend_by_month = defaultdict(int)
        for txn in txns:
            if txn.account_id == card.id:
                # Statement balances are in the card currency, so convert any
                # foreign-currency charges at their booked rate
                amount = txn.amount
                if txn.fx_rate is not None:
                    amount = round(amount * float(txn.fx_rate))
                spend_by_month[txn.dt.replace(day=1)] += amount

        for month_start, spend in sorted(spend_by_month.items()):
            payment_day = _add_months(month_start, 1).replace(day=25)
            if payment_day > TODAY or spend >= 0:
                continue
            payments.append(_txn(
                user.id, chequing, payment_day, None, system["Credit Card Payment"],
                spend, notes="Card payment",
            ))
            payments.append(_txn(
                user.id, card, payment_day, None, system["Credit Card Payment"],
                -spend, notes="Payment received",
            ))
    return payments


def _balance_snapshots(accounts, txns):
    """Build daily balance snapshots matching the app's maintenance convention

    One row per account day with activity carrying the running balance, plus a
    zero anchor on the creation day for accounts with no opening transaction
    """
    daily_deltas = defaultdict(lambda: defaultdict(int))
    for txn in txns:
        amount = txn.amount
        if txn.fx_rate is not None:
            amount = round(amount * float(txn.fx_rate))
        daily_deltas[txn.account_id][txn.dt] += amount

    snapshots = []
    for account in accounts.values():
        deltas = daily_deltas[account.id]
        if WINDOW_START not in deltas:
            snapshots.append(AccountBalanceSnapshot(account_id=account.id, dt=WINDOW_START, balance=0))
        balance = 0
        for day in sorted(deltas):
            balance += deltas[day]
            snapshots.append(AccountBalanceSnapshot(account_id=account.id, dt=day, balance=balance))
    return snapshots


async def _seed_budgets(db, users, categories):
    """Create recurring and one-off budgets with instances covering the window

    Recurring budgets are backdated to the window start so their history spans
    the whole generated series, and each period instance carries the creation
    time its period began
    """
    alice, marco = users["alice"], users["marco"]
    system = categories["system"]
    window_created_at = datetime.combine(WINDOW_START, datetime.min.time(), tzinfo=UTC)

    groceries = BaseBudget(
        owner_id=alice.id, name="Monthly Groceries", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=1, recurrence_dom=1, recurs=True,
        created_at=window_created_at,
    )
    getaway = BaseBudget(
        owner_id=alice.id, name="Weekend Getaway", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=1, recurrence_dom=1, recurs=False,
        created_at=datetime.combine(TODAY.replace(day=1), datetime.min.time(), tzinfo=UTC),
    )
    utilities = BaseBudget(
        owner_id=alice.id, name="Utilities", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=1, recurrence_dom=1, recurs=True,
        created_at=window_created_at,
    )
    weekly_food = BaseBudget(
        owner_id=marco.id, name="Weekly Food", currency="CAD",
        recurrence_freq=RecurrenceFreq.WEEKLY, instance_length=1, recurrence_weekday=0, recurs=True,
        created_at=window_created_at,
    )
    db.add_all([groceries, getaway, utilities, weekly_food])
    await db.flush()

    # The internet category was tracked for a while and later removed, leaving
    # the history reconstruction path with real data to work against
    db.add_all([
        BudgetTrackedCategory(base_budget_id=groceries.id, category_id=system["Groceries"].id,
                              added_at=WINDOW_START),
        BudgetTrackedCategory(base_budget_id=getaway.id, category_id=system["Travel"].id,
                              added_at=TODAY.replace(day=1)),
        BudgetTrackedCategory(base_budget_id=utilities.id, category_id=system["Electricity"].id,
                              added_at=WINDOW_START),
        BudgetTrackedCategory(base_budget_id=utilities.id, category_id=system["Water"].id,
                              added_at=WINDOW_START),
        BudgetTrackedCategory(base_budget_id=utilities.id, category_id=system["Internet"].id,
                              added_at=WINDOW_START, removed_at=_add_months(WINDOW_START, 9)),
        BudgetTrackedCategory(base_budget_id=weekly_food.id, category_id=system["Groceries"].id,
                              added_at=WINDOW_START),
        BudgetTrackedCategory(base_budget_id=weekly_food.id, category_id=system["Dining"].id,
                              added_at=WINDOW_START),
    ])

    def instance(base_budget, period_start, period_end, overall_limit):
        return Budget(
            base_budget_id=base_budget.id, period_start=period_start,
            period_end=period_end, overall_limit=overall_limit,
            created_at=datetime.combine(period_start, datetime.min.time(), tzinfo=UTC),
        )

    instances = []
    for month_start in _month_starts():
        period_end = compute_period_end(month_start, RecurrenceFreq.MONTHLY, 1, dom=1)
        instances.append(instance(groceries, month_start, period_end, 60_000))
        instances.append(instance(utilities, month_start, period_end, 25_000))

    current_month = TODAY.replace(day=1)
    instances.append(instance(
        getaway, current_month,
        compute_period_end(current_month, RecurrenceFreq.MONTHLY, 1, dom=1), 40_000,
    ))

    week_start = _weekly_dates(0)[0]
    while week_start <= TODAY:
        week_end = compute_period_end(week_start, RecurrenceFreq.WEEKLY, 1)
        instances.append(instance(weekly_food, week_start, week_end, 15_000))
        week_start = week_end + timedelta(days=1)

    db.add_all(instances)
    await db.flush()
    return len(instances)


async def _seed_preferences(db, users, accounts):
    """Create runway account picks and saved insights ranges"""
    db.add_all([
        UserRunwayAccount(user_id=users["alice"].id, account_id=accounts["alice_chequing"].id),
        UserRunwayAccount(user_id=users["alice"].id, account_id=accounts["alice_savings"].id),
        UserRunwayAccount(user_id=users["marco"].id, account_id=accounts["marco_chequing"].id),
        UserRunwayAccount(user_id=users["marco"].id, account_id=accounts["marco_savings"].id),
        SavedInsightsRange(user_id=users["alice"].id, name="Past 3 months", amount=3, unit="month", qualifier="past"),
        SavedInsightsRange(user_id=users["alice"].id, name="This year", amount=1, unit="year", qualifier="this"),
        SavedInsightsRange(user_id=users["marco"].id, name="Past 30 days", amount=30, unit="day", qualifier="past"),
    ])
    await db.flush()


def _apply_contribution_accruals(tax_advantaged, contributions):
    """Top up stored accruals so they match the generated contribution transfers"""
    for key in ("tfsa", "rrsp", "fhsa"):
        for year, amount in contributions[key].items():
            tax_advantaged["limits"][(key, year)].accrued_contributions = amount
            tax_advantaged[key].accrued_contributions += amount


async def seed_dev_data() -> None:
    """Replace the demo users' data with a freshly generated trailing year"""
    print(f"Seeding demo data for {WINDOW_START} through {TODAY}...")
    session_factory = create_migration_sessionmaker()
    async with session_factory() as db:
        await _delete_demo_data(db)
        system_categories = await _load_reference_data(db)

        institutions = await _seed_institutions(db)
        users = await _seed_users(db)
        categories = await _seed_categories(db, users, system_categories)
        merchants = await _seed_merchants(db, users, categories)
        tags = await _seed_tags(db, users)
        tax_advantaged = await _seed_tax_advantaged_categories(db, users)
        accounts = await _seed_accounts(db, users, institutions, tax_advantaged)

        contributions = {"tfsa": defaultdict(int), "rrsp": defaultdict(int), "fhsa": defaultdict(int)}
        txns = _starting_balance_transactions(users, accounts, system_categories)
        tag_pairs = []
        built, pairs = _alice_transactions(users, accounts, categories, merchants, tags, contributions)
        txns.extend(built)
        tag_pairs.extend(pairs)
        built, pairs = _marco_transactions(users, accounts, categories, merchants, tags)
        txns.extend(built)
        tag_pairs.extend(pairs)

        txns.extend(_investment_activity(users, accounts, categories, txns))
        txns.extend(_archive_old_savings(users, accounts, categories, txns))
        txns.extend(_credit_card_payments(users, accounts, categories, txns))
        db.add_all(txns)
        await db.flush()

        db.add_all(
            TransactionTag(transaction_id=txn.id, tag_id=tag_id)
            for txn, tag_id in tag_pairs
        )

        snapshots = _balance_snapshots(accounts, txns)
        db.add_all(snapshots)

        _apply_contribution_accruals(tax_advantaged, contributions)
        instance_count = await _seed_budgets(db, users, categories)
        await _seed_preferences(db, users, accounts)

        await db.commit()

    print(f"  Users: {len(DEMO_USER_EMAILS)}, Accounts: {len(accounts)}")
    print(f"  Transactions: {len(txns)}, Snapshots: {len(snapshots)}")
    print(f"  Budget instances: {instance_count}")
    print(f"Seed complete, log in as {', '.join(DEMO_USER_EMAILS)} with password {PASSWORD}")


if __name__ == "__main__":
    asyncio.run(seed_dev_data())
