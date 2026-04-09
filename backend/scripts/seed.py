"""Seed the development database with realistic financial data.

###########################################################
###### PURELY WRITTEN BY AI. DEVELOPMENT USE ONLY. ########
###########################################################

# TODO: build a proper seed/migration script for production
# (reference data like currencies, canonical institutions, default categories, etc.)

Creates 3 users across 2 groups with ~3 months of transactions,
budgets, and balance history. All users share password "password123".

Run from the backend directory:
    python -m scripts.seed
"""

import asyncio
import calendar
import random
from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import text

from app.database import async_session, engine

# Register remaining model modules with Base.metadata for truncation
from app.models import active_token as _active_token  # noqa: F401
from app.models.account import Account, AccountBalanceSnapshot, AccountPermission
from app.models.auth import AuthIdentity, PasswordCredential
from app.models.base import (
    AccountType,
    AuthProvider,
    Base,
    CategoryKind,
    InstitutionStatus,
    PermissionLevel,
    RecurrenceFreq,
    TaxTreatment,
)
from app.models.budget import (
    BaseBudget,
    Budget,
    BudgetPermission,
    BudgetTrackedCategory,
)
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.models.institution import Institution
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.user import User
from app.services.auth import _hash_password
from app.services.budget_periods import compute_period_end

PASSWORD = "password123"  # noqa: S105

rng = random.Random(42)  # noqa: S311


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------


def _salary_dates():
    """1st and 15th of each month, Jan-Mar 2026."""
    dates = []
    for month in range(1, 4):
        dates.append(date(2026, month, 1))
        dates.append(date(2026, month, 15))
    return dates


def _monthly_on(dom):
    """One date per month on the given day-of-month, Jan-Mar 2026."""
    dates = []
    for m in range(1, 4):
        last_day = calendar.monthrange(2026, m)[1]
        dates.append(date(2026, m, min(dom, last_day)))
    return dates


def _weekly_on(weekday):
    """Every occurrence of the given weekday in Jan 1 - Mar 31 2026."""
    start, end = date(2026, 1, 1), date(2026, 3, 31)
    d = start
    while d.weekday() != weekday:
        d += timedelta(days=1)
    dates = []
    while d <= end:
        dates.append(d)
        d += timedelta(days=7)
    return dates


def _random_dates(per_month):
    """Random dates spread across each month, Jan-Mar 2026."""
    dates = []
    for m in range(1, 4):
        last_day = calendar.monthrange(2026, m)[1]
        days = sorted(rng.sample(range(1, last_day + 1), min(per_month, last_day)))
        dates.extend(date(2026, m, d) for d in days)
    return dates


# ---------------------------------------------------------------------------
# Builder helpers
# ---------------------------------------------------------------------------


def _txn(user_id, account_id, day, merchant_id, category_id, amount,
         *, hour=12, currency="CAD", notes=None):
    """Build a Transaction ORM object."""
    return Transaction(
        created_by_user_id=user_id,
        account_id=account_id,
        ts=datetime(day.year, day.month, day.day, hour, 0, tzinfo=UTC),
        merchant_id=merchant_id,
        category_id=category_id,
        amount=amount,
        currency=currency,
        notes=notes,
    )


def _make_categories(owner_id, group_id, expenses, incomes=(), transfers=()):
    """Create Category objects keyed by name."""
    cats = {}
    for name in expenses:
        cats[name] = Category(
            owner_id=owner_id, group_id=group_id,
            name=name, kind=CategoryKind.EXPENSE,
        )
    for name in incomes:
        cats[name] = Category(
            owner_id=owner_id, group_id=group_id,
            name=name, kind=CategoryKind.INCOME,
        )
    for name in transfers:
        cats[name] = Category(
            owner_id=owner_id, group_id=group_id,
            name=name, kind=CategoryKind.TRANSFER,
        )
    return cats


# ---------------------------------------------------------------------------
# Main seed function
# ---------------------------------------------------------------------------


async def main():
    """Seed the development database with realistic data."""
    print("Seeding database...")

    # Wipe all existing data
    async with engine.begin() as conn:
        table_names = ", ".join(
            t.name for t in reversed(Base.metadata.sorted_tables)
        )
        await conn.execute(text(f"TRUNCATE {table_names} CASCADE"))
    print("  Truncated all tables")

    async with async_session() as db:
        await _seed_currencies(db)
        institutions = await _seed_institutions(db)
        users = await _seed_users(db)
        groups = await _seed_groups(db, users)
        categories = await _seed_categories(db, users, groups)
        merchants = await _seed_merchants(db, users, groups, categories)
        tags = await _seed_tags(db, users, groups)
        accounts = await _seed_accounts(db, users, groups, institutions)
        await _seed_transactions(db, users, groups, accounts, categories, merchants, tags)
        await _seed_budgets(db, users, groups, categories)
        await _seed_permissions(db, users, groups, accounts)

        await db.commit()
        print("\nSeed complete!")


# ---------------------------------------------------------------------------
# Seed steps
# ---------------------------------------------------------------------------


async def _seed_currencies(db):
    db.add_all([
        Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2),
        Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
        Currency(id="EUR", name="Euro", symbol="€", minor_unit_exponent=2),
        Currency(id="GBP", name="British Pound", symbol="£", minor_unit_exponent=2),
        Currency(id="JPY", name="Japanese Yen", symbol="¥", minor_unit_exponent=0),
    ])
    await db.flush()
    print("  Currencies: 5")


async def _seed_institutions(db):
    td = Institution(
        status=InstitutionStatus.CANONICAL,
        name="TD Bank", country_code="CA", website="https://www.td.com",
    )
    rbc = Institution(
        status=InstitutionStatus.CANONICAL,
        name="RBC Royal Bank", country_code="CA",
        website="https://www.rbcroyalbank.com",
    )
    ws = Institution(
        status=InstitutionStatus.CANONICAL,
        name="Wealthsimple", country_code="CA",
        website="https://www.wealthsimple.com",
    )
    tang = Institution(
        status=InstitutionStatus.CANONICAL,
        name="Tangerine", country_code="CA",
        website="https://www.tangerine.ca",
    )
    db.add_all([td, rbc, ws, tang])
    await db.flush()
    print("  Institutions: 4")
    return {"td": td, "rbc": rbc, "ws": ws, "tang": tang}


async def _seed_users(db):
    alice = User(
        email="alice@example.com", first_name="Alice", last_name="Chen",
        tz="America/Toronto", base_currency="CAD",
    )
    bob = User(
        email="bob@example.com", first_name="Bob", last_name="Martinez",
        tz="America/Toronto", base_currency="CAD",
    )
    charlie = User(
        email="charlie@example.com", first_name="Charlie", last_name="Kim",
        tz="America/Vancouver", base_currency="CAD",
    )
    db.add_all([alice, bob, charlie])
    await db.flush()

    verified_at = datetime(2025, 12, 1, tzinfo=UTC)
    for u in [alice, bob, charlie]:
        db.add(AuthIdentity(
            user_id=u.id, auth_provider=AuthProvider.PASSWORD,
            email_verified=True, email_verified_at=verified_at,
        ))
        db.add(PasswordCredential(
            user_id=u.id,
            password_hash=_hash_password(PASSWORD),
            password_algo="argon2id",  # noqa: S106
        ))
    await db.flush()
    print("  Users: 3 (with auth)")
    return {"alice": alice, "bob": bob, "charlie": charlie}


async def _seed_groups(db, users):
    alice, bob, charlie = users["alice"], users["bob"], users["charlie"]

    household = Group(owner_id=alice.id, name="Chen-Martinez Household")
    roommates = Group(owner_id=charlie.id, name="Roommates Fund")
    db.add_all([household, roommates])
    await db.flush()

    db.add_all([
        GroupMember(group_id=household.id, user_id=alice.id, is_admin=True),
        GroupMember(group_id=household.id, user_id=bob.id, is_admin=True),
        GroupMember(group_id=roommates.id, user_id=charlie.id, is_admin=True),
        GroupMember(group_id=roommates.id, user_id=bob.id, is_admin=False),
    ])
    await db.flush()
    print("  Groups: 2, Members: 4")
    return {"household": household, "roommates": roommates}


async def _seed_categories(db, users, groups):
    alice, bob, charlie = users["alice"], users["bob"], users["charlie"]
    household, roommates = groups["household"], groups["roommates"]

    personal_expenses = [
        "Groceries", "Dining Out", "Transportation", "Entertainment",
        "Shopping", "Utilities", "Health", "Subscriptions", "Personal Care",
    ]
    personal_incomes = ["Salary", "Freelance", "Interest"]
    personal_transfers = ["Internal Transfer"]

    alice_cats = _make_categories(
        alice.id, None, personal_expenses, personal_incomes, personal_transfers,
    )
    bob_cats = _make_categories(
        bob.id, None, personal_expenses, personal_incomes, personal_transfers,
    )
    charlie_cats = _make_categories(
        charlie.id, None, personal_expenses, personal_incomes, personal_transfers,
    )

    # Group categories — some names deliberately match personal ones
    household_cats = _make_categories(
        alice.id, household.id,
        ["Groceries", "Dining Out", "Utilities", "Home", "Savings Goal"],
    )
    roommates_cats = _make_categories(
        charlie.id, roommates.id,
        ["Rent", "Utilities", "Groceries", "Cleaning Supplies"],
    )

    all_cats = (
        list(alice_cats.values()) + list(bob_cats.values())
        + list(charlie_cats.values())
        + list(household_cats.values()) + list(roommates_cats.values())
    )
    db.add_all(all_cats)
    await db.flush()
    print(f"  Categories: {len(all_cats)}")

    return {
        "alice": alice_cats, "bob": bob_cats, "charlie": charlie_cats,
        "household": household_cats, "roommates": roommates_cats,
    }


async def _seed_merchants(db, users, groups, categories):
    alice, bob, charlie = users["alice"], users["bob"], users["charlie"]
    household, roommates = groups["household"], groups["roommates"]
    ac, bc, cc = categories["alice"], categories["bob"], categories["charlie"]
    hc, rc = categories["household"], categories["roommates"]

    alice_m = {
        "Acme Corp": Merchant(owner_id=alice.id, name="Acme Corp", default_category_id=ac["Salary"].id),
        "Loblaws": Merchant(owner_id=alice.id, name="Loblaws", default_category_id=ac["Groceries"].id),
        "Metro": Merchant(owner_id=alice.id, name="Metro", default_category_id=ac["Groceries"].id),
        "Uber Eats": Merchant(owner_id=alice.id, name="Uber Eats", default_category_id=ac["Dining Out"].id),
        "Pai Northern Thai": Merchant(owner_id=alice.id, name="Pai Northern Thai", default_category_id=ac["Dining Out"].id),
        "TTC": Merchant(owner_id=alice.id, name="TTC", default_category_id=ac["Transportation"].id),
        "Netflix": Merchant(owner_id=alice.id, name="Netflix", default_category_id=ac["Subscriptions"].id),
        "Spotify": Merchant(owner_id=alice.id, name="Spotify", default_category_id=ac["Subscriptions"].id),
        "GoodLife Fitness": Merchant(owner_id=alice.id, name="GoodLife Fitness", default_category_id=ac["Subscriptions"].id),
        "Amazon": Merchant(owner_id=alice.id, name="Amazon", default_category_id=ac["Shopping"].id),
        "Shoppers Drug Mart": Merchant(owner_id=alice.id, name="Shoppers Drug Mart", default_category_id=ac["Personal Care"].id),
    }
    bob_m = {
        "TechStart Inc": Merchant(owner_id=bob.id, name="TechStart Inc", default_category_id=bc["Salary"].id),
        "No Frills": Merchant(owner_id=bob.id, name="No Frills", default_category_id=bc["Groceries"].id),
        "Petro-Canada": Merchant(owner_id=bob.id, name="Petro-Canada", default_category_id=bc["Transportation"].id),
        "Steam": Merchant(owner_id=bob.id, name="Steam", default_category_id=bc["Entertainment"].id),
        "Cineplex": Merchant(owner_id=bob.id, name="Cineplex", default_category_id=bc["Entertainment"].id),
        "Canadian Tire": Merchant(owner_id=bob.id, name="Canadian Tire", default_category_id=bc["Shopping"].id),
        "Wealthsimple": Merchant(owner_id=bob.id, name="Wealthsimple", default_category_id=bc["Internal Transfer"].id),
    }
    charlie_m = {
        "Bean & Brew": Merchant(owner_id=charlie.id, name="Bean & Brew", default_category_id=cc["Dining Out"].id),
        "FreshCo": Merchant(owner_id=charlie.id, name="FreshCo", default_category_id=cc["Groceries"].id),
        "Part-Time Job": Merchant(owner_id=charlie.id, name="Part-Time Job", default_category_id=cc["Salary"].id),
        "Dollarama": Merchant(owner_id=charlie.id, name="Dollarama", default_category_id=cc["Shopping"].id),
    }

    # Group merchants — "Loblaws" and "FreshCo" deliberately duplicate personal names
    household_m = {
        "Costco": Merchant(owner_id=alice.id, group_id=household.id, name="Costco", default_category_id=hc["Groceries"].id),
        "The Keg": Merchant(owner_id=alice.id, group_id=household.id, name="The Keg", default_category_id=hc["Dining Out"].id),
        "Toronto Hydro": Merchant(owner_id=alice.id, group_id=household.id, name="Toronto Hydro", default_category_id=hc["Utilities"].id),
        "Enbridge Gas": Merchant(owner_id=alice.id, group_id=household.id, name="Enbridge Gas", default_category_id=hc["Utilities"].id),
        "Loblaws": Merchant(owner_id=alice.id, group_id=household.id, name="Loblaws", default_category_id=hc["Groceries"].id),
    }
    roommates_m = {
        "Landlord - 45 King": Merchant(
            owner_id=charlie.id, group_id=roommates.id,
            name="Landlord - 45 King", default_category_id=rc["Rent"].id,
        ),
        "BC Hydro": Merchant(owner_id=charlie.id, group_id=roommates.id, name="BC Hydro", default_category_id=rc["Utilities"].id),
        "Save-On-Foods": Merchant(owner_id=charlie.id, group_id=roommates.id, name="Save-On-Foods", default_category_id=rc["Groceries"].id),
        "FreshCo": Merchant(owner_id=charlie.id, group_id=roommates.id, name="FreshCo", default_category_id=rc["Groceries"].id),
    }

    all_merchants = (
        list(alice_m.values()) + list(bob_m.values()) + list(charlie_m.values())
        + list(household_m.values()) + list(roommates_m.values())
    )
    db.add_all(all_merchants)
    await db.flush()
    print(f"  Merchants: {len(all_merchants)}")

    return {
        "alice": alice_m, "bob": bob_m, "charlie": charlie_m,
        "household": household_m, "roommates": roommates_m,
    }


async def _seed_tags(db, users, groups):
    alice, bob, charlie = users["alice"], users["bob"], users["charlie"]
    household, roommates = groups["household"], groups["roommates"]

    alice_tag = Tag(owner_id=alice.id, name="recurring")
    bob_tag = Tag(owner_id=bob.id, name="recurring")
    charlie_tag = Tag(owner_id=charlie.id, name="recurring")
    household_tag = Tag(owner_id=alice.id, group_id=household.id, name="shared")
    roommates_tag = Tag(owner_id=charlie.id, group_id=roommates.id, name="shared")

    db.add_all([alice_tag, bob_tag, charlie_tag, household_tag, roommates_tag])
    await db.flush()
    print("  Tags: 5")

    return {
        "alice": alice_tag, "bob": bob_tag, "charlie": charlie_tag,
        "household": household_tag, "roommates": roommates_tag,
    }


async def _seed_accounts(db, users, groups, institutions):
    alice, bob, charlie = users["alice"], users["bob"], users["charlie"]
    household, roommates = groups["household"], groups["roommates"]
    td, rbc, ws, tang = (
        institutions["td"], institutions["rbc"],
        institutions["ws"], institutions["tang"],
    )

    accts = {
        "alice_chequing": Account(
            owner_id=alice.id, account_type=AccountType.CHECKING,
            name="TD Chequing", institution_id=td.id, currency="CAD",
        ),
        "alice_tfsa": Account(
            owner_id=alice.id, account_type=AccountType.SAVINGS,
            tax_treatment=TaxTreatment.TAX_FREE,
            name="TFSA", institution_id=ws.id, currency="CAD",
        ),
        "alice_visa": Account(
            owner_id=alice.id, account_type=AccountType.CREDIT_CARD,
            name="Visa Infinite", institution_id=td.id, currency="CAD",
        ),
        "bob_chequing": Account(
            owner_id=bob.id, account_type=AccountType.CHECKING,
            name="RBC Chequing", institution_id=rbc.id, currency="CAD",
        ),
        "bob_rrsp": Account(
            owner_id=bob.id, account_type=AccountType.INVESTMENT,
            tax_treatment=TaxTreatment.TAX_DEFERRED,
            name="RRSP", institution_id=ws.id, currency="CAD",
        ),
        "bob_visa": Account(
            owner_id=bob.id, account_type=AccountType.CREDIT_CARD,
            name="RBC Visa", institution_id=rbc.id, currency="CAD",
        ),
        "charlie_chequing": Account(
            owner_id=charlie.id, account_type=AccountType.CHECKING,
            name="Tangerine Chequing", institution_id=tang.id, currency="CAD",
        ),
        "charlie_savings": Account(
            owner_id=charlie.id, account_type=AccountType.SAVINGS,
            name="Tangerine Savings", institution_id=tang.id, currency="CAD",
        ),
        "charlie_cash": Account(
            owner_id=charlie.id, account_type=AccountType.CASH,
            name="Cash Wallet", currency="CAD",
        ),
        "household_savings": Account(
            group_id=household.id, account_type=AccountType.SAVINGS,
            name="Joint Savings", institution_id=td.id, currency="CAD",
        ),
        "roommates_expenses": Account(
            group_id=roommates.id, account_type=AccountType.CHECKING,
            name="Shared Expenses Account", institution_id=tang.id, currency="CAD",
        ),
    }

    db.add_all(accts.values())
    await db.flush()
    print(f"  Accounts: {len(accts)}")
    return accts


async def _seed_transactions(db, users, groups, accounts, categories, merchants, tags):
    """Generate ~195 transactions across Jan-Mar 2026."""
    alice, bob, charlie = users["alice"], users["bob"], users["charlie"]
    ac, bc, cc = categories["alice"], categories["bob"], categories["charlie"]
    hc, rc = categories["household"], categories["roommates"]
    am, bm, cm = merchants["alice"], merchants["bob"], merchants["charlie"]
    hm, rm = merchants["household"], merchants["roommates"]
    at, bt, ct = tags["alice"], tags["bob"], tags["charlie"]
    ht, rt = tags["household"], tags["roommates"]

    a_chq = accounts["alice_chequing"]
    a_tfsa = accounts["alice_tfsa"]
    a_visa = accounts["alice_visa"]
    b_chq = accounts["bob_chequing"]
    b_rrsp = accounts["bob_rrsp"]
    b_visa = accounts["bob_visa"]
    c_chq = accounts["charlie_chequing"]
    c_sav = accounts["charlie_savings"]
    c_cash = accounts["charlie_cash"]
    h_sav = accounts["household_savings"]
    r_exp = accounts["roommates_expenses"]

    txns = []
    tag_pairs = []  # [(Transaction, tag_id)]

    # ---- Alice ----

    # Salary: +$2,250 biweekly
    for d in _salary_dates():
        t = _txn(alice.id, a_chq.id, d, am["Acme Corp"].id,
                 ac["Salary"].id, 225_000, hour=9, notes="Biweekly salary")
        txns.append(t)
        tag_pairs.append((t, at.id))

    # Groceries: $80-150/week on visa (Saturday runs)
    for d in _weekly_on(5):
        merchant = rng.choice([am["Loblaws"], am["Metro"]])
        txns.append(_txn(
            alice.id, a_visa.id, d, merchant.id,
            ac["Groceries"].id, -rng.randint(8_000, 15_000), hour=11,
        ))

    # Dining out: $30-80, ~4x/month
    for d in _random_dates(4):
        merchant = rng.choice([am["Uber Eats"], am["Pai Northern Thai"]])
        txns.append(_txn(
            alice.id, a_visa.id, d, merchant.id,
            ac["Dining Out"].id, -rng.randint(3_000, 8_000), hour=19,
        ))

    # Metro pass: $156/month on 2nd
    for d in _monthly_on(2):
        t = _txn(alice.id, a_visa.id, d, am["TTC"].id,
                 ac["Transportation"].id, -15_600, hour=8)
        txns.append(t)
        tag_pairs.append((t, at.id))

    # Rideshares: $15-30, sporadic
    for d in _random_dates(2)[:5]:
        txns.append(_txn(
            alice.id, a_visa.id, d, None,
            ac["Transportation"].id, -rng.randint(1_500, 3_000), hour=22,
            notes="Uber ride",
        ))

    # Subscriptions (monthly)
    for d in _monthly_on(10):
        t = _txn(alice.id, a_visa.id, d, am["Netflix"].id,
                 ac["Subscriptions"].id, -1_649, hour=0)
        txns.append(t)
        tag_pairs.append((t, at.id))
    for d in _monthly_on(12):
        t = _txn(alice.id, a_visa.id, d, am["Spotify"].id,
                 ac["Subscriptions"].id, -1_099, hour=0)
        txns.append(t)
        tag_pairs.append((t, at.id))
    for d in _monthly_on(5):
        t = _txn(alice.id, a_visa.id, d, am["GoodLife Fitness"].id,
                 ac["Subscriptions"].id, -5_000, hour=0)
        txns.append(t)
        tag_pairs.append((t, at.id))

    # Shopping: $30-200, ~3x/month
    for d in _random_dates(3):
        merchant = rng.choice([am["Amazon"], am["Shoppers Drug Mart"]])
        cat = ac["Shopping"] if merchant is am["Amazon"] else ac["Personal Care"]
        txns.append(_txn(
            alice.id, a_visa.id, d, merchant.id,
            cat.id, -rng.randint(3_000, 20_000), hour=14,
        ))

    # CC payment from chequing (~$1,200/month, both legs)
    for d in _monthly_on(22):
        amount = rng.randint(115_000, 135_000)
        txns.append(_txn(
            alice.id, a_chq.id, d, None, ac["Internal Transfer"].id,
            -amount, hour=10, notes="Visa payment",
        ))
        txns.append(_txn(
            alice.id, a_visa.id, d, None, ac["Internal Transfer"].id,
            amount, hour=10, notes="Payment received",
        ))

    # TFSA contributions: $500/month
    for d in _monthly_on(20):
        txns.append(_txn(
            alice.id, a_chq.id, d, None, ac["Internal Transfer"].id,
            -50_000, hour=10, notes="TFSA contribution",
        ))
        txns.append(_txn(
            alice.id, a_tfsa.id, d, None, ac["Internal Transfer"].id,
            50_000, hour=10, notes="Contribution from chequing",
        ))

    # Household contributions: $500/month
    for d in _monthly_on(10):
        txns.append(_txn(
            alice.id, a_chq.id, d, None, ac["Internal Transfer"].id,
            -50_000, hour=10, notes="Household contribution",
        ))
        t = _txn(alice.id, h_sav.id, d, None, hc["Savings Goal"].id,
                 50_000, hour=10, notes="Alice's contribution")
        txns.append(t)
        tag_pairs.append((t, ht.id))

    # ---- Bob ----

    # Salary: +$2,000 biweekly
    for d in _salary_dates():
        t = _txn(bob.id, b_chq.id, d, bm["TechStart Inc"].id,
                 bc["Salary"].id, 200_000, hour=9, notes="Biweekly salary")
        txns.append(t)
        tag_pairs.append((t, bt.id))

    # Groceries: $70-120/week on visa (Monday runs)
    for d in _weekly_on(0):
        txns.append(_txn(
            bob.id, b_visa.id, d, bm["No Frills"].id,
            bc["Groceries"].id, -rng.randint(7_000, 12_000), hour=18,
        ))

    # Entertainment: $50-100, ~3x/month
    for d in _random_dates(3):
        merchant = rng.choice([bm["Steam"], bm["Cineplex"]])
        txns.append(_txn(
            bob.id, b_visa.id, d, merchant.id,
            bc["Entertainment"].id, -rng.randint(5_000, 10_000), hour=20,
        ))

    # Gas: $60-80, ~2x/month
    for d in _random_dates(2):
        txns.append(_txn(
            bob.id, b_visa.id, d, bm["Petro-Canada"].id,
            bc["Transportation"].id, -rng.randint(6_000, 8_000), hour=17,
        ))

    # Car insurance: $180/month from chequing on 3rd
    for d in _monthly_on(3):
        t = _txn(bob.id, b_chq.id, d, None, bc["Transportation"].id,
                 -18_000, hour=0, notes="Car insurance")
        txns.append(t)
        tag_pairs.append((t, bt.id))

    # RRSP: $500/month on 25th (both legs)
    for d in _monthly_on(25):
        txns.append(_txn(
            bob.id, b_chq.id, d, bm["Wealthsimple"].id,
            bc["Internal Transfer"].id, -50_000, hour=10,
            notes="RRSP contribution",
        ))
        txns.append(_txn(
            bob.id, b_rrsp.id, d, bm["Wealthsimple"].id,
            bc["Internal Transfer"].id, 50_000, hour=10,
            notes="Contribution from chequing",
        ))

    # Shopping: $40-150, ~4 total
    for d in _random_dates(2)[:4]:
        txns.append(_txn(
            bob.id, b_visa.id, d, bm["Canadian Tire"].id,
            bc["Shopping"].id, -rng.randint(4_000, 15_000), hour=15,
        ))

    # CC payment from chequing (~$900/month, both legs)
    for d in _monthly_on(23):
        amount = rng.randint(80_000, 100_000)
        txns.append(_txn(
            bob.id, b_chq.id, d, None, bc["Internal Transfer"].id,
            -amount, hour=10, notes="Visa payment",
        ))
        txns.append(_txn(
            bob.id, b_visa.id, d, None, bc["Internal Transfer"].id,
            amount, hour=10, notes="Payment received",
        ))

    # Household contributions: $500/month
    for d in _monthly_on(10):
        txns.append(_txn(
            bob.id, b_chq.id, d, None, bc["Internal Transfer"].id,
            -50_000, hour=10, notes="Household contribution",
        ))
        t = _txn(bob.id, h_sav.id, d, None, hc["Savings Goal"].id,
                 50_000, hour=10, notes="Bob's contribution")
        txns.append(t)
        tag_pairs.append((t, ht.id))

    # Roommates contributions: $1,050/month on 1st
    for d in _monthly_on(1):
        txns.append(_txn(
            bob.id, b_chq.id, d, None, bc["Internal Transfer"].id,
            -105_000, hour=10, notes="Roommates rent + utilities",
        ))
        t = _txn(bob.id, r_exp.id, d, None, rc["Rent"].id,
                 105_000, hour=10, notes="Bob's share — rent & utilities")
        txns.append(t)
        tag_pairs.append((t, rt.id))

    # ---- Charlie ----

    # Part-time salary: +$1,000 biweekly
    for d in _salary_dates():
        t = _txn(charlie.id, c_chq.id, d, cm["Part-Time Job"].id,
                 cc["Salary"].id, 100_000, hour=9, notes="Biweekly pay")
        txns.append(t)
        tag_pairs.append((t, ct.id))

    # Groceries on chequing: $60-100/week (Thursdays, first 9 weeks)
    thursdays = _weekly_on(3)
    for d in thursdays[:9]:
        txns.append(_txn(
            charlie.id, c_chq.id, d, cm["FreshCo"].id,
            cc["Groceries"].id, -rng.randint(6_000, 10_000), hour=16,
        ))

    # Groceries on cash: last 4 Thursdays
    for d in thursdays[9:]:
        txns.append(_txn(
            charlie.id, c_cash.id, d, cm["FreshCo"].id,
            cc["Groceries"].id, -rng.randint(6_000, 10_000), hour=16,
        ))

    # Dining: $20-40, ~3x/month (take 8 total)
    for d in _random_dates(3)[:8]:
        txns.append(_txn(
            charlie.id, c_chq.id, d, cm["Bean & Brew"].id,
            cc["Dining Out"].id, -rng.randint(2_000, 4_000), hour=12,
        ))

    # Rent contribution to shared account: $950/month on 1st
    for d in _monthly_on(1):
        txns.append(_txn(
            charlie.id, c_chq.id, d, None, cc["Internal Transfer"].id,
            -95_000, hour=10, notes="Rent contribution",
        ))
        t = _txn(charlie.id, r_exp.id, d, None, rc["Rent"].id,
                 95_000, hour=10, notes="Charlie's share — rent")
        txns.append(t)
        tag_pairs.append((t, rt.id))

    # Utilities contribution to shared: $100/month on 1st
    for d in _monthly_on(1):
        txns.append(_txn(
            charlie.id, c_chq.id, d, None, cc["Internal Transfer"].id,
            -10_000, hour=10, notes="Utilities contribution",
        ))
        t = _txn(charlie.id, r_exp.id, d, None, rc["Utilities"].id,
                 10_000, hour=10, notes="Charlie's share — utilities")
        txns.append(t)
        tag_pairs.append((t, rt.id))

    # Savings transfers: $200-300/month on 15th
    for d in _monthly_on(15):
        amount = rng.randint(20_000, 30_000)
        txns.append(_txn(
            charlie.id, c_chq.id, d, None, cc["Internal Transfer"].id,
            -amount, hour=10, notes="Savings transfer",
        ))
        txns.append(_txn(
            charlie.id, c_sav.id, d, None, cc["Internal Transfer"].id,
            amount, hour=10, notes="From chequing",
        ))

    # ---- Household group (joint savings) ----

    # Costco / Loblaws groceries: $150-300, ~3x/month
    for d in _random_dates(3):
        merchant = rng.choice([hm["Costco"], hm["Loblaws"]])
        creator = rng.choice([alice, bob])
        t = _txn(creator.id, h_sav.id, d, merchant.id,
                 hc["Groceries"].id, -rng.randint(15_000, 30_000), hour=11)
        txns.append(t)
        tag_pairs.append((t, ht.id))

    # The Keg dining: $80-150, ~2x/month (take 5 total)
    for d in _random_dates(2)[:5]:
        creator = rng.choice([alice, bob])
        t = _txn(creator.id, h_sav.id, d, hm["The Keg"].id,
                 hc["Dining Out"].id, -rng.randint(8_000, 15_000), hour=19)
        txns.append(t)
        tag_pairs.append((t, ht.id))

    # Toronto Hydro: ~$120/month on 15th
    for d in _monthly_on(15):
        t = _txn(alice.id, h_sav.id, d, hm["Toronto Hydro"].id,
                 hc["Utilities"].id, -rng.randint(10_000, 14_000), hour=0)
        txns.append(t)
        tag_pairs.append((t, ht.id))

    # Enbridge Gas: ~$80/month on 18th
    for d in _monthly_on(18):
        t = _txn(alice.id, h_sav.id, d, hm["Enbridge Gas"].id,
                 hc["Utilities"].id, -rng.randint(6_000, 10_000), hour=0)
        txns.append(t)
        tag_pairs.append((t, ht.id))

    # ---- Roommates group (shared expenses) ----

    # Rent to landlord: $1,900/month on 2nd
    for d in _monthly_on(2):
        t = _txn(charlie.id, r_exp.id, d, rm["Landlord - 45 King"].id,
                 rc["Rent"].id, -190_000, hour=10, notes="Monthly rent")
        txns.append(t)
        tag_pairs.append((t, rt.id))

    # BC Hydro: ~$80/month on 20th
    for d in _monthly_on(20):
        t = _txn(charlie.id, r_exp.id, d, rm["BC Hydro"].id,
                 rc["Utilities"].id, -rng.randint(7_000, 9_000), hour=0)
        txns.append(t)
        tag_pairs.append((t, rt.id))

    # Shared groceries: $60-100, ~2x/month
    for d in _random_dates(2):
        merchant = rng.choice([rm["Save-On-Foods"], rm["FreshCo"]])
        creator = rng.choice([charlie, bob])
        t = _txn(creator.id, r_exp.id, d, merchant.id,
                 rc["Groceries"].id, -rng.randint(6_000, 10_000), hour=13)
        txns.append(t)
        tag_pairs.append((t, rt.id))

    # Persist transactions
    db.add_all(txns)
    await db.flush()

    # Transaction tags
    tt_rows = [
        TransactionTag(transaction_id=t.id, tag_id=tag_id)
        for t, tag_id in tag_pairs
    ]
    db.add_all(tt_rows)
    await db.flush()
    print(f"  Transactions: {len(txns)}, Tags applied: {len(tt_rows)}")

    # ---- Balance snapshots ----
    opening_balances = {
        a_chq.id: 300_000,      # $3,000
        a_tfsa.id: 1_500_000,   # $15,000
        a_visa.id: 0,
        b_chq.id: 250_000,      # $2,500
        b_rrsp.id: 2_000_000,   # $20,000
        b_visa.id: 0,
        c_chq.id: 150_000,      # $1,500
        c_sav.id: 500_000,      # $5,000
        c_cash.id: 20_000,      # $200
        h_sav.id: 1_000_000,    # $10,000
        r_exp.id: 200_000,      # $2,000
    }

    # Aggregate daily deltas per account
    daily_deltas = defaultdict(lambda: defaultdict(int))
    for t in txns:
        daily_deltas[t.account_id][t.ts.date()] += t.amount

    snapshot_count = 0
    for acct_id, opening in opening_balances.items():
        # Opening snapshot at Dec 31 midnight UTC
        db.add(AccountBalanceSnapshot(
            account_id=acct_id, balance=opening,
            ts=datetime(2025, 12, 31, tzinfo=UTC),
        ))
        snapshot_count += 1

        balance = opening
        for day in sorted(daily_deltas.get(acct_id, {}).keys()):
            balance += daily_deltas[acct_id][day]
            db.add(AccountBalanceSnapshot(
                account_id=acct_id, balance=balance,
                ts=datetime.combine(day, time.min, tzinfo=UTC),
            ))
            snapshot_count += 1

    await db.flush()
    print(f"  Balance snapshots: {snapshot_count}")


async def _seed_budgets(db, users, groups, categories):
    alice, charlie = users["alice"], users["charlie"]
    household = groups["household"]
    ac, cc, hc = categories["alice"], categories["charlie"], categories["household"]

    # Alice: Monthly Groceries (recurring)
    alice_grocery = BaseBudget(
        owner_id=alice.id, name="Monthly Groceries", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=1,
        recurrence_dom=1, recurs=True,
    )
    # Alice: Spring Wardrobe (one-off)
    alice_wardrobe = BaseBudget(
        owner_id=alice.id, name="Spring Wardrobe", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=1,
        recurrence_dom=1, recurs=False,
    )
    # Household: Household Expenses (recurring)
    household_budget = BaseBudget(
        group_id=household.id, name="Household Expenses", currency="CAD",
        recurrence_freq=RecurrenceFreq.MONTHLY, instance_length=1,
        recurrence_dom=1, recurs=True,
    )
    # Charlie: Weekly Food (recurring)
    charlie_food = BaseBudget(
        owner_id=charlie.id, name="Weekly Food", currency="CAD",
        recurrence_freq=RecurrenceFreq.WEEKLY, instance_length=1,
        recurrence_weekday=0, recurs=True,
    )

    db.add_all([alice_grocery, alice_wardrobe, household_budget, charlie_food])
    await db.flush()

    # Tracked categories
    db.add_all([
        BudgetTrackedCategory(base_budget_id=alice_grocery.id, category_id=ac["Groceries"].id),
        BudgetTrackedCategory(base_budget_id=alice_wardrobe.id, category_id=ac["Shopping"].id),
        BudgetTrackedCategory(base_budget_id=household_budget.id, category_id=hc["Groceries"].id),
        BudgetTrackedCategory(base_budget_id=household_budget.id, category_id=hc["Dining Out"].id),
        BudgetTrackedCategory(base_budget_id=household_budget.id, category_id=hc["Utilities"].id),
        BudgetTrackedCategory(base_budget_id=charlie_food.id, category_id=cc["Groceries"].id),
        BudgetTrackedCategory(base_budget_id=charlie_food.id, category_id=cc["Dining Out"].id),
    ])
    await db.flush()

    # Budget instances
    instances = []

    # Alice Monthly Groceries: Jan-Mar, $600 limit
    for m in range(1, 4):
        start = date(2026, m, 1)
        end = compute_period_end(start, RecurrenceFreq.MONTHLY, 1, dom=1)
        instances.append(Budget(
            base_budget_id=alice_grocery.id,
            period_start=start, period_end=end, overall_limit=60_000,
        ))

    # Alice Spring Wardrobe: Mar only, $400 limit
    start = date(2026, 3, 1)
    end = compute_period_end(start, RecurrenceFreq.MONTHLY, 1, dom=1)
    instances.append(Budget(
        base_budget_id=alice_wardrobe.id,
        period_start=start, period_end=end, overall_limit=40_000,
    ))

    # Household Expenses: Jan-Mar, $1,500 limit
    for m in range(1, 4):
        start = date(2026, m, 1)
        end = compute_period_end(start, RecurrenceFreq.MONTHLY, 1, dom=1)
        instances.append(Budget(
            base_budget_id=household_budget.id,
            period_start=start, period_end=end, overall_limit=150_000,
        ))

    # Charlie Weekly Food: 12 weeks starting Jan 5 (first Monday), $150 limit
    week_start = date(2026, 1, 5)
    for _ in range(12):
        week_end = compute_period_end(week_start, RecurrenceFreq.WEEKLY, 1)
        instances.append(Budget(
            base_budget_id=charlie_food.id,
            period_start=week_start, period_end=week_end, overall_limit=15_000,
        ))
        week_start = week_end + timedelta(days=1)

    db.add_all(instances)
    await db.flush()
    print(f"  Budgets: 4 base, {len(instances)} instances")

    return {"household_budget": household_budget}


async def _seed_permissions(db, users, groups, accounts):
    bob = users["bob"]
    household, roommates = groups["household"], groups["roommates"]
    # _seed_budgets returns the household budget, but we need it here.
    # Re-query or pass it through — for simplicity, query the base budget by name.
    from sqlalchemy import select as sa_select

    household_budget = (await db.execute(
        sa_select(BaseBudget).where(
            BaseBudget.group_id == household.id,
            BaseBudget.name == "Household Expenses",
        )
    )).scalar_one()

    db.add_all([
        AccountPermission(
            group_id=household.id, user_id=bob.id,
            account_id=accounts["household_savings"].id,
            level=PermissionLevel.WRITE,
        ),
        BudgetPermission(
            group_id=household.id, user_id=bob.id,
            base_budget_id=household_budget.id,
            level=PermissionLevel.READ,
        ),
        AccountPermission(
            group_id=roommates.id, user_id=bob.id,
            account_id=accounts["roommates_expenses"].id,
            level=PermissionLevel.READ,
        ),
    ])
    await db.flush()
    print("  Permissions: 3")


if __name__ == "__main__":
    asyncio.run(main())
