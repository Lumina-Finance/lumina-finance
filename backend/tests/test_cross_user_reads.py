"""Another user's rows stay unread, not only unreturned

Row-level security already keeps another user's rows out of every result. These tests guard the
cost side: a read rule, list query or check that visits every user's rows slows every page of
every user as one account's data grows, so each case counts the rows its statements touched in a
table and holds that below what the other user keeps there

Tables this small make a full scan the cheapest plan, so most cases turn sequential scans off for
their transaction. Postgres still scans in full when no other plan exists, which is what a rule or
join with no key to narrow by leaves it, so the count proves a plan exists that reads only the
caller's rows.

That proves nothing where a query can reach the user's rows from either side of a join, or where
Postgres can walk a whole index while counting only the entries it returns. Those cases seed a
crowd of users with thousands of rows, let the planner choose, and count the blocks read instead
"""

import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account, TaxAdvantagedCategory
from app.models.base import AccountKind, AccountType, CategoryKind, RecurrenceFreq, TaxTreatment
from app.models.budget import BaseBudget, Budget, BudgetTrackedCategory
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.models.user import User
from app.services.transactions.link_candidates import list_refund_link_candidates
from app.services.transactions.listing import list_transaction_responses
from tests.conftest import TestSession
from tests.routes.support.identity_helpers import _act_as

# How many rows the other user keeps in each table. Every case's own reads stay well below it,
# so reaching it means the statement visited the other user's rows
OTHER_ROWS = 60

# How many more users, and transactions between them, the cases that need real volume add
CROWD = 200
MANY_ROWS = 20000

# The month every seeded transaction and the budget fall in, long past, so no date cutoff applies
PERIOD_START = date(2026, 3, 1)
PERIOD_END = date(2026, 3, 31)

# The rows this transaction has read from a table so far, by sequential scans of it and entries
# returned by its indexes, including index-only scans that never visit the table, and including
# what any function or foreign key check it ran read
_ROWS_READ = text(
    "SELECT pg_stat_get_xact_tuples_returned(c.oid)"
    " + coalesce((SELECT sum(pg_stat_get_xact_tuples_returned(i.indexrelid)) FROM pg_index i WHERE i.indrelid = c.oid), 0)"
    " FROM pg_class c WHERE c.oid = to_regclass(:table)"
)


async def _rows_read(session: AsyncSession, table: str) -> int:
    """Return how many rows of a table this transaction has read so far"""
    return (await session.execute(_ROWS_READ, {"table": table})).scalar_one()


# The blocks of a table and its indexes this transaction has asked for so far, counting each time it
# asked, and including what any function or foreign key check it ran asked for. Beside them, how
# many blocks the table and its indexes hold
_BLOCKS_READ = text(
    "SELECT sum(pg_stat_get_xact_blocks_fetched(relation.oid)),"
    " (pg_relation_size(:table) + pg_indexes_size(:table)) / current_setting('block_size')::int"
    " FROM (SELECT to_regclass(:table)::oid AS oid UNION ALL SELECT indexrelid FROM pg_index WHERE indrelid = to_regclass(:table)) relation"
)


async def _assert_reads_few_blocks(session: AsyncSession, table: str) -> None:
    """Fail when this transaction has read a quarter or more of the blocks a table and its indexes hold

    The crowd's rows fill nearly all of them, so a read near that share went through the crowd's rows
    """
    blocks_read, blocks_held = (await session.execute(_BLOCKS_READ, {"table": table})).one()
    assert blocks_read < blocks_held / 4, f"read {blocks_read} of the {blocks_held} blocks of {table}"


async def _avoid_full_scans(session: AsyncSession) -> None:
    """Have the planner take any plan other than a sequential scan for the rest of the transaction"""
    await session.execute(text("SET LOCAL enable_seqscan = off"))


def _build_user(email: str) -> User:
    """Return an unsaved user"""
    return User(email=email, first_name="Test", tz="America/Toronto", base_currency="CAD")


def _build_account(owner_id: uuid.UUID, name: str) -> Account:
    """Return an unsaved personal chequing account"""
    return Account(owner_id=owner_id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name=name, currency="CAD")


def _build_transaction(user_id: uuid.UUID, account_id: uuid.UUID, category_id: uuid.UUID, amount: int, day: int) -> Transaction:
    """Return an unsaved transaction in the seeded month"""
    return Transaction(
        created_by_user_id=user_id,
        account_id=account_id,
        dt=PERIOD_START.replace(day=day),
        category_id=category_id,
        amount=amount,
        currency="CAD",
    )


@pytest.fixture
async def ledgers():
    """Seed a user with a small ledger and another user with OTHER_ROWS of everything

    Both users' transactions sit in the same system category and month, tagged, and the other
    user's incoming rows are linked as refunds, so every shared key a query could join on
    reaches the other user's rows too
    """
    user = _build_user("user@example.com")
    other = _build_user("other@example.com")
    async with TestSession() as session:
        session.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
        session.add_all([user, other])
        await session.flush()
        groceries_id = await session.scalar(select(Category.id).where(Category.is_system, Category.kind == CategoryKind.EXPENSE).limit(1))

        account = _build_account(user.id, "Chequing")
        other_accounts = [_build_account(other.id, f"Other {index}") for index in range(OTHER_ROWS)]
        session.add_all([account, *other_accounts])
        await session.flush()

        expense = _build_transaction(user.id, account.id, groceries_id, -2500, 10)
        refund = _build_transaction(user.id, account.id, groceries_id, 1000, 12)
        other_transactions = [
            _build_transaction(other.id, other_accounts[0].id, groceries_id, 500 if index % 2 else -500, 1 + index % 28)
            for index in range(OTHER_ROWS)
        ]
        session.add_all([expense, refund, *other_transactions])

        trip = Tag(owner_id=user.id, name="Trip")
        work = Tag(owner_id=user.id, name="Work")
        other_tags = [Tag(owner_id=other.id, name=f"Other {index}") for index in range(OTHER_ROWS)]
        session.add_all([trip, work, *other_tags])
        session.add_all([Category(owner_id=other.id, name=f"Other {index}", kind=CategoryKind.EXPENSE) for index in range(OTHER_ROWS)])
        session.add_all([Merchant(owner_id=other.id, name=f"Other {index}") for index in range(OTHER_ROWS)])
        session.add_all(
            [
                TaxAdvantagedCategory(
                    category_owner_user_id=owner.id, name=f"Savings {index}", tax_treatment=TaxTreatment.TAX_FREE, currency="CAD"
                )
                for owner, index in [(user, 0), *((other, index) for index in range(OTHER_ROWS))]
            ]
        )
        session.add_all(
            [
                BaseBudget(owner_id=other.id, name=f"Other {index}", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY)
                for index in range(OTHER_ROWS)
            ]
        )
        base_budget = BaseBudget(owner_id=user.id, name="Food", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY)
        session.add(base_budget)
        await session.flush()

        session.add_all(
            [
                TransactionTag(transaction_id=expense.id, tag_id=trip.id),
                TransactionTag(transaction_id=expense.id, tag_id=work.id),
                TransactionTag(transaction_id=refund.id, tag_id=trip.id),
                *(TransactionTag(transaction_id=row.id, tag_id=tag.id) for row, tag in zip(other_transactions, other_tags, strict=True)),
            ]
        )
        session.add_all(
            [
                TransactionLink(refund_transaction_id=refund_row.id, original_transaction_id=expense_row.id)
                for expense_row, refund_row in zip(other_transactions[0::2], other_transactions[1::2], strict=True)
            ]
        )
        budget = Budget(base_budget_id=base_budget.id, period_start=PERIOD_START, period_end=PERIOD_END, overall_limit=100000)
        session.add(budget)
        session.add(BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=groceries_id, added_at=date(2026, 1, 1)))
        unused_category = Category(owner_id=user.id, name="Unused", kind=CategoryKind.EXPENSE)
        unused_tag = Tag(owner_id=user.id, name="Unused")
        session.add_all([unused_category, unused_tag])
        await session.flush()

        # Tells the planner which keys are shared by every row, such as the one category every
        # transaction is in, as a real database's statistics would
        await session.execute(text("ANALYZE"))
        await session.commit()

    return {
        "user": user,
        "other": other,
        "other_account": other_accounts[0],
        "other_tag": other_tags[0],
        "category_id": groceries_id,
        "expense": expense,
        "refund": refund,
        "trip": trip,
        "work": work,
        "budget": budget,
        "unused_category": unused_category,
        "unused_tag": unused_tag,
    }


@pytest.fixture
async def crowded_ledgers(ledgers):
    """Add CROWD users with an account each, holding MANY_ROWS transactions between them

    Where a query can reach the user's rows from either side of a join, two users' tables leave the
    planner's choice arbitrary, since each key seems to hold half the rows, and turning sequential
    scans off only moves it to walking a whole index. These cases need many users whose rows
    outnumber the user's, as in a real database, for the plan they get to be the one it gets. The
    transactions are all tagged and in the shared category and month
    """
    async with TestSession() as session:
        crowd = [_build_user(f"crowd{index}@example.com") for index in range(CROWD)]
        session.add_all(crowd)
        await session.flush()
        accounts = [_build_account(member.id, "Chequing") for member in crowd]
        session.add_all(accounts)
        await session.flush()

        account_ids = [account.id for account in accounts]
        await session.execute(
            text(
                "INSERT INTO transactions (id, created_by_user_id, account_id, dt, category_id, amount, currency)"
                " SELECT gen_random_uuid(), a.owner_id, a.id, :day, :category_id, -100, 'CAD'"
                " FROM public.accounts a CROSS JOIN generate_series(1, :per_account)"
                " WHERE a.id = ANY(:account_ids)"
            ),
            {"day": PERIOD_START, "category_id": ledgers["category_id"], "per_account": MANY_ROWS // CROWD, "account_ids": account_ids},
        )
        await session.execute(
            text(
                "INSERT INTO transaction_tags (transaction_id, tag_id)"
                " SELECT id, :tag_id FROM public.transactions WHERE account_id = ANY(:account_ids)"
            ),
            {"tag_id": ledgers["other_tag"].id, "account_ids": account_ids},
        )
        await session.execute(text("ANALYZE"))
        await session.commit()
    return ledgers


@pytest.mark.parametrize(
    ("model", "table"),
    [
        (Account, "accounts"),
        (Transaction, "transactions"),
        (Tag, "tags"),
        (Category, "categories"),
        (Merchant, "merchants"),
        (TaxAdvantagedCategory, "tax_advantaged_categories"),
        (BaseBudget, "base_budgets"),
    ],
)
async def test_reading_a_table_reads_none_of_another_users_rows(ledgers, model, table):
    """Listing a table under its read rule touches only rows the rule can narrow to by key"""
    async with _act_as(ledgers["user"].id) as session:
        await _avoid_full_scans(session)
        visible = (await session.scalars(select(model.id))).all()
        rows_read = await _rows_read(session, table)

    # System categories and merchants are everyone's, so the rows the user sees are read too
    assert visible, "the user's own rows come back, so a rule refusing everything can't pass"
    assert rows_read - len(visible) < OTHER_ROWS, f"read {rows_read} rows of {table} to return {len(visible)}"


@pytest.mark.parametrize(
    "listing",
    [
        pytest.param({"sort_by": "dt"}, id="date-sorted first page"),
        pytest.param({"sort_by": "dt", "offset": 1, "limit": 1}, id="date-sorted later page"),
        pytest.param({"sort_by": "amount", "tag_match": "any"}, id="any of the tags"),
        pytest.param({"sort_by": "amount", "tag_match": "all"}, id="all of the tags"),
    ],
)
async def test_listing_transactions_reads_none_of_another_users_transactions_or_tags(crowded_ledgers, listing):
    """A list page, sorted by date with tag names breaking ties or filtered by tags, reads only the user's own rows"""
    ledgers = crowded_ledgers
    tag_ids = [ledgers["trip"].id, ledgers["work"].id] if "tag_match" in listing else None
    async with _act_as(ledgers["user"].id) as session:
        page = await list_transaction_responses(session, ledgers["user"], tag_ids=tag_ids, **listing)

        assert page, "the user's own transactions come back"
        await _assert_reads_few_blocks(session, "transactions")
        await _assert_reads_few_blocks(session, "transaction_tags")


async def test_refund_candidates_read_none_of_another_users_links(ledgers):
    """Leaving out money already linked as a refund checks only the user's own transactions for links"""
    async with _act_as(ledgers["user"].id) as session:
        await _avoid_full_scans(session)
        candidates = await list_refund_link_candidates(session, ledgers["user"], ledgers["expense"].id, None)
        links_read = await _rows_read(session, "transaction_links")

    assert [candidate.id for candidate in candidates] == [ledgers["refund"].id]
    assert links_read < OTHER_ROWS / 2, f"read {links_read} refund links"


async def test_budget_spending_reads_none_of_another_users_transactions_in_the_category(crowded_ledgers):
    """Spending on a budget tracking a shared category reads only the budget owner's transactions"""
    ledgers = crowded_ledgers
    spend = text("SELECT sum(amount_sum) FROM public.budget_spend_rows(:budget_ids, :now)")
    async with _act_as(ledgers["user"].id) as session:
        total = (await session.execute(spend, {"budget_ids": [ledgers["budget"].id], "now": datetime.now(UTC)})).scalar_one()

        assert total == -1500
        await _assert_reads_few_blocks(session, "transactions")


async def test_deleting_an_unused_category_reads_none_of_another_users_transactions(ledgers):
    """The check that no transaction is still in a deleted category looks it up by key"""
    async with _act_as(ledgers["user"].id) as session:
        await _avoid_full_scans(session)
        await session.execute(delete(Category).where(Category.id == ledgers["unused_category"].id))
        await session.flush()
        rows_read = await _rows_read(session, "transactions")

    assert rows_read < OTHER_ROWS, f"read {rows_read} transactions"


async def test_deleting_an_unused_tag_reads_none_of_another_users_tag_links(crowded_ledgers):
    """The check that no transaction still carries a deleted tag looks it up by key"""
    ledgers = crowded_ledgers
    async with _act_as(ledgers["user"].id) as session:
        await session.execute(delete(Tag).where(Tag.id == ledgers["unused_tag"].id))
        await session.flush()

        await _assert_reads_few_blocks(session, "transaction_tags")
