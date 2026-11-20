"""Another user's rows stay unread, not only unreturned

Row-level security already keeps another user's rows out of every result. These tests guard the
cost side: a read rule, list query or check that visits every user's rows slows every page of
every user as one account's data grows, so each case counts the rows its statements touched in a
table and allows only a few beyond those it returns

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

from app.models.account import Account, AccountPermission, TaxAdvantagedCategory
from app.models.bank_connection import BankAccountLink
from app.models.base import AccountKind, AccountType, CategoryKind, PermissionLevel, RecurrenceFreq, TaxTreatment
from app.models.budget import BaseBudget, Budget, BudgetPermission, BudgetTrackedCategory
from app.models.category import Category
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.models.merchant import Merchant
from app.models.tag import Tag, TransactionTag
from app.models.transaction import Transaction
from app.models.transaction_link import TransactionLink
from app.services.transactions.link_candidates import list_refund_link_candidates
from app.services.transactions.listing import list_transaction_responses
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_account, _build_unlinked_link, _build_user
from tests.routes.support.identity_helpers import _act_as
from tests.routes.support.query_cost_helpers import SLACK, _avoid_full_scans, _rows_read

# How many rows the other user keeps in each table
OTHER_ROWS = 60

# When budget spending runs, a fixed time long after the seeded month, so no date cutoff applies
NOW = datetime(2026, 11, 18, 12, tzinfo=UTC)

# How many more users, and transactions between them, the cases that need real volume add
CROWD = 200
MANY_ROWS = 20000

# The month every seeded transaction and the budget fall in, long past, so no date cutoff applies
PERIOD_START = date(2026, 3, 1)
PERIOD_END = date(2026, 3, 31)

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


def _build_group_account(group_id: uuid.UUID) -> Account:
    """Return an unsaved chequing account held by a group"""
    return Account(group_id=group_id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Joint", currency="CAD")


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
        session.add_all([Merchant(owner_id=other.id, name=f"Other {index}", default_category_id=groceries_id) for index in range(OTHER_ROWS)])
        merchant = Merchant(owner_id=user.id, name="Corner Store")
        session.add(merchant)
        tax_category = TaxAdvantagedCategory(
            category_owner_user_id=user.id, name="Savings", tax_treatment=TaxTreatment.TAX_FREE, currency="CAD"
        )
        session.add(tax_category)
        session.add_all(
            [
                TaxAdvantagedCategory(
                    category_owner_user_id=other.id, name=f"Savings {index}", tax_treatment=TaxTreatment.TAX_FREE, currency="CAD"
                )
                for index in range(OTHER_ROWS)
            ]
        )
        other_base_budgets = [
            BaseBudget(owner_id=other.id, name=f"Other {index}", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY)
            for index in range(OTHER_ROWS)
        ]
        base_budget = BaseBudget(owner_id=user.id, name="Food", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY)
        session.add_all([*other_base_budgets, base_budget])
        await session.flush()

        session.add_all(
            [
                BudgetTrackedCategory(base_budget_id=other_base_budget.id, category_id=groceries_id, added_at=date(2026, 1, 1))
                for other_base_budget in other_base_budgets
            ]
        )
        bank_link = _build_unlinked_link(account)
        session.add_all([bank_link, *(_build_unlinked_link(other_account) for other_account in other_accounts)])
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
        tracked_category = BudgetTrackedCategory(base_budget_id=base_budget.id, category_id=groceries_id, added_at=date(2026, 1, 1))
        session.add(tracked_category)
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
        # The user's own rows in each table the read rule cases list
        "own": {
            "accounts": {account.id},
            "transactions": {expense.id, refund.id},
            "tags": {trip.id, work.id, unused_tag.id},
            "categories": {unused_category.id},
            "merchants": {merchant.id},
            "tax_advantaged_categories": {tax_category.id},
            "base_budgets": {base_budget.id},
            "budget_tracked_categories": {tracked_category.id},
            "bank_account_links": {bank_link.id},
        },
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
        (BudgetTrackedCategory, "budget_tracked_categories"),
        (BankAccountLink, "bank_account_links"),
    ],
)
async def test_reading_a_table_reads_none_of_another_users_rows(ledgers, model, table):
    """Listing a table under its read rule touches only rows the rule can narrow to by key"""
    async with _act_as(ledgers["user"].id) as session:
        await _avoid_full_scans(session)
        visible = (await session.scalars(select(model.id))).all()
        rows_read = await _rows_read(session, table)

    # System categories and merchants are everyone's, so the rows the user sees are read too
    assert ledgers["own"][table] <= set(visible), "the user's own rows come back, so a rule refusing them can't pass"
    assert rows_read - len(visible) < SLACK, f"read {rows_read} rows of {table} to return {len(visible)}"


@pytest.fixture
async def crowded_grants(ledgers):
    """Give the other user MANY_ROWS groups they administer, each granting them an account and a budget

    Three of these tables have a key that leads on the group, which Postgres can walk whole while
    returning only the user's entries, so only many groups make such a walk show. The user
    administers a group of their own and holds grants in one the other user owns, so each set has
    rows of the user's to find
    """
    user_id, other_id = ledgers["user"].id, ledgers["other"].id
    async with TestSession() as session:
        own_group = Group(owner_id=user_id, name="Home")
        shared_group = Group(owner_id=other_id, name="Shared")
        session.add_all([own_group, shared_group])
        await session.flush()
        session.add_all(
            [
                GroupMember(group_id=own_group.id, user_id=user_id, is_admin=True),
                GroupMember(group_id=shared_group.id, user_id=other_id, is_admin=True),
                GroupMember(group_id=shared_group.id, user_id=user_id),
            ]
        )
        own_group_account = _build_group_account(own_group.id)
        shared_account = _build_group_account(shared_group.id)
        shared_budget = BaseBudget(group_id=shared_group.id, name="Shared", currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY)
        shared_tag = Tag(owner_id=other_id, group_id=shared_group.id, name="Shared")
        session.add_all([own_group_account, shared_account, shared_budget, shared_tag])
        await session.flush()
        session.add_all(
            [
                AccountPermission(group_id=shared_group.id, user_id=user_id, account_id=shared_account.id, level=PermissionLevel.READ),
                BudgetPermission(group_id=shared_group.id, user_id=user_id, base_budget_id=shared_budget.id, level=PermissionLevel.READ),
            ]
        )
        await session.flush()

        await session.execute(
            text("INSERT INTO groups (id, owner_id, name) SELECT gen_random_uuid(), :other_id, 'Other' FROM generate_series(1, :count)"),
            {"other_id": other_id, "count": MANY_ROWS},
        )
        await session.execute(
            text(
                "INSERT INTO group_members (group_id, user_id, is_admin)"
                " SELECT id, owner_id, true FROM public.groups WHERE owner_id = :other_id AND name = 'Other'"
            ),
            {"other_id": other_id},
        )
        await session.execute(
            text(
                "INSERT INTO account_permissions (id, group_id, user_id, account_id, level)"
                " SELECT gen_random_uuid(), id, owner_id, :account_id, 'WRITE' FROM public.groups"
                " WHERE owner_id = :other_id AND name = 'Other'"
            ),
            {"other_id": other_id, "account_id": ledgers["other_account"].id},
        )
        await session.execute(
            text(
                "INSERT INTO budget_permissions (id, group_id, user_id, base_budget_id, level)"
                " SELECT gen_random_uuid(), g.id, g.owner_id, b.id, 'READ'"
                " FROM public.groups g CROSS JOIN LATERAL (SELECT id FROM public.base_budgets WHERE owner_id = :other_id LIMIT 1) b"
                " WHERE g.owner_id = :other_id AND g.name = 'Other'"
            ),
            {"other_id": other_id},
        )
        await session.execute(text("ANALYZE"))
        await session.commit()
    # The rows each read reaches only through the user's group or grants
    reached = {Account: {own_group_account.id, shared_account.id}, BaseBudget: {shared_budget.id}, Tag: {shared_tag.id}}
    return {**ledgers, "reached": reached}


@pytest.mark.parametrize("table", ["groups", "group_members", "account_permissions", "budget_permissions"])
async def test_working_out_what_a_user_reaches_reads_none_of_another_users_grants(crowded_grants, table):
    """The read rules find the user's groups and grants by key, not by reading every user's"""
    async with _act_as(crowded_grants["user"].id) as session:
        for model, reached in crowded_grants["reached"].items():
            visible = set((await session.scalars(select(model.id))).all())
            assert reached <= visible, f"{model.__tablename__} misses rows the user's groups and grants reach"
        await _assert_reads_few_blocks(session, table)


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
    assert links_read < SLACK, f"read {links_read} refund links"


async def test_budget_spending_reads_none_of_another_users_transactions_in_the_category(crowded_ledgers):
    """Spending on a budget tracking a shared category reads only the budget owner's transactions"""
    ledgers = crowded_ledgers
    spend = text("SELECT sum(amount_sum) FROM public.budget_spend_rows(:budget_ids, :now)")
    async with _act_as(ledgers["user"].id) as session:
        total = (await session.execute(spend, {"budget_ids": [ledgers["budget"].id], "now": NOW})).scalar_one()

        assert total == -1500
        await _assert_reads_few_blocks(session, "transactions")


@pytest.mark.parametrize("referencing_table", ["transactions", "merchants", "budget_tracked_categories"])
async def test_deleting_an_unused_category_reads_none_of_another_users_rows(ledgers, referencing_table):
    """Each check that nothing still names a deleted category looks it up by key"""
    async with _act_as(ledgers["user"].id) as session:
        await _avoid_full_scans(session)
        await session.execute(delete(Category).where(Category.id == ledgers["unused_category"].id))
        await session.flush()
        rows_read = await _rows_read(session, referencing_table)

    assert rows_read < SLACK, f"read {rows_read} rows of {referencing_table}"


async def test_deleting_an_unused_tag_reads_none_of_another_users_tag_links(crowded_ledgers):
    """The check that no transaction still carries a deleted tag looks it up by key"""
    ledgers = crowded_ledgers
    async with _act_as(ledgers["user"].id) as session:
        await session.execute(delete(Tag).where(Tag.id == ledgers["unused_tag"].id))
        await session.flush()

        await _assert_reads_few_blocks(session, "transaction_tags")
