"""Route tests for GET /accounts/{account_id}/spending-breakdown."""
import importlib
import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.models.transaction import Transaction
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header, _get_system_merchant_id

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


def _today_utc() -> date:
    """Return the Toronto-local "today" the default test user uses."""
    return datetime.now(ZoneInfo("America/Toronto")).date()


def _range_start(range_: str, today: date) -> date:
    """Replicate the service's _range_bounds start date for a given range

    Tests seed transactions on both sides of the returned boundary and verify
    only in-range ones are counted
    """
    if range_ == "WTD":
        return today - timedelta(days=today.weekday())
    if range_ == "MTD":
        return date(today.year, today.month, 1)
    if range_ == "QTD":
        q_month = ((today.month - 1) // 3) * 3 + 1
        return date(today.year, q_month, 1)
    # YTD
    return date(today.year, 1, 1)


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories. Defaults to a unique expense category

    New users get a default set of categories seeded on signup (Groceries,
    Salary, Transfer, ...). To avoid 409 conflicts with those, we use a
    "Test " prefix that doesn't collide with any default name
    """
    payload = {"name": "Test Groceries", "kind": "expense", **overrides}
    return await client.post("/categories", json=payload, headers=headers)


async def _create_merchant(client, headers, **overrides):
    """Create a merchant via POST /merchants."""
    payload = {"name": "Costco", **overrides}
    return await client.post("/merchants", json=payload, headers=headers)


async def _create_transaction(client, headers, account_id, category_id, **overrides):
    """Create a transaction via POST /transactions."""
    payload = {
        "account_id": account_id,
        "category_id": category_id,
        "dt": _today_utc().isoformat(),
        "amount": -5000,
        "currency": "CAD",
        **overrides,
    }

    # The route requires a merchant, so a test that does not care which one gets the shared Myself
    if "merchant_id" not in payload:
        payload["merchant_id"] = await _get_system_merchant_id(client, headers)
    return await client.post("/transactions", json=payload, headers=headers)


async def _create_second_user(client):
    """Sign up a second user and return (auth_headers, user_id)."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "SecurePassword123!",
        "first_name": "Other",
        "tz": "America/Toronto",
        "base_currency": "CAD",
    })
    return _get_auth_header(resp), resp.json()["user"]["id"]


async def _create_group(client, headers):
    """Create a group and return its id."""
    resp = await client.post("/groups", json={"name": "Smith Family"}, headers=headers)
    return resp.json()["id"]


async def _grant_account_permission(client, admin_headers, account_id, user_id, level):
    """Grant a user explicit access on a group account."""
    return await client.post(
        f"/accounts/{account_id}/permissions",
        json={"user_id": user_id, "level": level},
        headers=admin_headers,
    )


async def _seed_usd_currency():
    """Seed USD so transactions with currency='USD' can be posted

    Used by the mixed-currency regression test. Mirrors conftest._seed_currency
    but runs inline so the currency is scoped to tests that actually need it
    """
    from app.models.currency import Currency
    from tests.conftest import TestSession
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()


async def _setup_account(client):
    """Shorthand: create a user, return (headers, account_id)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    return headers, account_resp.json()["id"]


# --- Range window tests ---


async def test_wtd_includes_transactions_since_monday_and_excludes_earlier(client):
    """WTD covers Monday-to-today; a transaction on the day before Monday is excluded."""
    headers, account_id = await _setup_account(client)
    category_id = (await _create_category(client, headers)).json()["id"]

    today = _today_utc()
    monday = _range_start("WTD", today)

    # In-range (today) and out-of-range (day before Monday)
    await _create_transaction(
        client, headers, account_id, category_id,
        dt=today.isoformat(), amount=-1000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        dt=(monday - timedelta(days=1)).isoformat(), amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "WTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["range"] == "WTD"
    assert data["grand_total_spend"] == 1000
    assert len(data["top_categories"]) == 1
    assert data["top_categories"][0]["total"] == 1000


async def test_mtd_includes_transactions_since_first_of_month_and_excludes_earlier(client):
    """MTD covers the 1st of the current month through today; prior day is excluded."""
    headers, account_id = await _setup_account(client)
    category_id = (await _create_category(client, headers)).json()["id"]

    today = _today_utc()
    month_start = _range_start("MTD", today)

    await _create_transaction(
        client, headers, account_id, category_id,
        dt=month_start.isoformat(), amount=-2000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        dt=(month_start - timedelta(days=1)).isoformat(), amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["range"] == "MTD"
    assert data["grand_total_spend"] == 2000
    assert len(data["top_categories"]) == 1
    assert data["top_categories"][0]["total"] == 2000


async def test_mtd_uses_viewer_timezone_at_utc_year_boundary(client, monkeypatch):
    """At Jan 1 01:00 UTC, a Toronto user is still in Dec 31 MTD."""
    account_routes = importlib.import_module("app.routes.accounts.router")

    class FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            instant = datetime(2026, 1, 1, 1, 0, tzinfo=UTC)
            return instant.astimezone(tz) if tz else instant

    monkeypatch.setattr(account_routes, "datetime", FixedDateTime)

    headers, account_id = await _setup_account(client)
    category_id = (await _create_category(client, headers)).json()["id"]

    await _create_transaction(client, headers, account_id, category_id, dt="2025-12-31", amount=-3100)
    await _create_transaction(client, headers, account_id, category_id, dt="2026-01-01", amount=-9999)

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )

    assert resp.status_code == 200
    assert resp.json()["grand_total_spend"] == 3100


async def test_qtd_includes_transactions_since_first_of_quarter_and_excludes_earlier(client):
    """QTD covers the 1st of the current quarter through today; prior day is excluded."""
    headers, account_id = await _setup_account(client)
    category_id = (await _create_category(client, headers)).json()["id"]

    today = _today_utc()
    quarter_start = _range_start("QTD", today)

    await _create_transaction(
        client, headers, account_id, category_id,
        dt=quarter_start.isoformat(), amount=-3000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        dt=(quarter_start - timedelta(days=1)).isoformat(), amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "QTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["range"] == "QTD"
    assert data["grand_total_spend"] == 3000
    assert len(data["top_categories"]) == 1
    assert data["top_categories"][0]["total"] == 3000


async def test_ytd_includes_transactions_since_january_first_and_excludes_earlier(client):
    """YTD covers Jan 1 through today; Dec 31 of the prior year is excluded."""
    headers, account_id = await _setup_account(client)
    category_id = (await _create_category(client, headers)).json()["id"]

    today = _today_utc()
    year_start = _range_start("YTD", today)

    await _create_transaction(
        client, headers, account_id, category_id,
        dt=year_start.isoformat(), amount=-4000,
    )
    await _create_transaction(
        client, headers, account_id, category_id,
        dt=(year_start - timedelta(days=1)).isoformat(), amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "YTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["range"] == "YTD"
    assert data["grand_total_spend"] == 4000
    assert len(data["top_categories"]) == 1
    assert data["top_categories"][0]["total"] == 4000


# --- Expense filter: transfers and income are excluded ---


async def test_transfer_and_income_transactions_do_not_contribute(client):
    """Transfer- and income-kind transactions are excluded from both breakdowns and the grand total."""
    headers, account_id = await _setup_account(client)

    expense_cat = (await _create_category(client, headers, name="Test Groceries", kind="expense")).json()
    transfer_cat = (await _create_category(client, headers, name="Test Internal Transfer", kind="transfer")).json()
    income_cat = (await _create_category(client, headers, name="Test Salary", kind="income")).json()

    merchant_expense = (await _create_merchant(client, headers, name="Costco")).json()
    merchant_transfer = (await _create_merchant(client, headers, name="Bank Link")).json()
    merchant_income = (await _create_merchant(client, headers, name="Employer Inc")).json()

    today = _today_utc().isoformat()
    # Real expense that should count
    await _create_transaction(
        client, headers, account_id, expense_cat["id"],
        dt=today, amount=-1500, merchant_id=merchant_expense["id"],
    )
    # Transfer — stored negative, but should never contribute to spending breakdown
    await _create_transaction(
        client, headers, account_id, transfer_cat["id"],
        dt=today, amount=-5000, merchant_id=merchant_transfer["id"],
    )
    # Income — positive amount, also excluded
    await _create_transaction(
        client, headers, account_id, income_cat["id"],
        dt=today, amount=200_000, merchant_id=merchant_income["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    # Only the expense transaction contributes
    assert data["grand_total_spend"] == 1500
    assert len(data["top_categories"]) == 1
    assert data["top_categories"][0]["category_id"] == expense_cat["id"]
    assert data["top_categories"][0]["name"] == "Test Groceries"
    assert data["top_categories"][0]["total"] == 1500

    assert len(data["top_merchants"]) == 1
    assert data["top_merchants"][0]["merchant_id"] == merchant_expense["id"]
    assert data["top_merchants"][0]["name"] == "Costco"
    assert data["top_merchants"][0]["total"] == 1500


# --- Merchant inner-join: category-only expense contributes to categories/total but not merchants ---


async def test_expense_without_merchant_contributes_to_categories_and_total_only(client):
    """An expense with merchant_id=None shows up in top_categories and grand_total but NOT top_merchants."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()
    merchant = (await _create_merchant(client, headers)).json()

    today = _today_utc()
    # One expense with a merchant, one without
    with_merchant = await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today.isoformat(), amount=-1000, merchant_id=merchant["id"],
    )

    # Inserted past the route, which now requires a merchant, since what is under test is how the
    # breakdown reports the transactions recorded before that rule
    async with TestSession() as session:
        session.add(Transaction(
            created_by_user_id=uuid.UUID(with_merchant.json()["created_by_user_id"]),
            account_id=uuid.UUID(account_id),
            dt=today,
            category_id=uuid.UUID(category["id"]),
            merchant_id=None,
            amount=-400,
            currency="CAD",
        ))
        await session.commit()

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    # Grand total includes both expenses
    assert data["grand_total_spend"] == 1400
    # Category total includes both — category id is the same for both rows
    assert len(data["top_categories"]) == 1
    assert data["top_categories"][0]["category_id"] == category["id"]
    assert data["top_categories"][0]["total"] == 1400
    # Merchant breakdown reflects only the transaction with a merchant
    assert len(data["top_merchants"]) == 1
    assert data["top_merchants"][0]["merchant_id"] == merchant["id"]
    assert data["top_merchants"][0]["total"] == 1000


# --- Top-5 cap and other counts ---


async def test_top_five_cap_with_seven_categories_and_nine_merchants(client):
    """Top-5 cap: with 7 distinct categories and 9 distinct merchants, response has 5 of each plus other counts."""
    headers, account_id = await _setup_account(client)

    today = _today_utc().isoformat()

    # Every transaction carries a merchant, so the base spends share one of their own rather than
    # landing on whichever merchant the helper would otherwise pick
    base_merchant = (await _create_merchant(client, headers, name="Base Spend")).json()

    # 7 categories. Category 0 gets a large base spend so it remains the biggest category even
    # after the 8 merchant transactions below pile onto another one, which keeps the category
    # ordering deterministic
    categories = []
    for i in range(7):
        cat = (await _create_category(client, headers, name=f"Test Cat {i}")).json()
        categories.append(cat)
        # Largest-first: Category 0 has -100_000, then 60_000 → 10_000 for 1..6
        base = 100_000 if i == 0 else (70_000 - i * 10_000)
        await _create_transaction(
            client, headers, account_id, cat["id"],
            dt=today, amount=-base, merchant_id=base_merchant["id"],
        )

    # 8 distinct merchants attached to the LAST of the 7 categories — that way
    # we exercise the 8-merchant bucket without introducing an 8th category
    merchant_bucket_cat = categories[-1]
    merchants = []
    for i in range(8):
        merch = (await _create_merchant(client, headers, name=f"Test Merchant {i}")).json()
        merchants.append(merch)
        await _create_transaction(
            client, headers, account_id, merchant_bucket_cat["id"],
            dt=today, amount=-(8000 - i * 100),  # -8000, -7900, ..., -7300
            merchant_id=merch["id"],
        )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    # Top-5 cap applied on both
    assert len(data["top_categories"]) == 5
    assert len(data["top_merchants"]) == 5
    # 7 categories → 2 beyond the top 5; 9 merchants → 4 beyond
    assert data["other_categories_count"] == 2
    assert data["other_merchants_count"] == 4

    # Category 0 remains the largest category (-100_000 base, no merchant pile)
    assert data["top_categories"][0]["category_id"] == categories[0]["id"]
    assert data["top_categories"][0]["total"] == 100_000

    # The base merchant carries every category's base spend, so it leads, followed by the four
    # largest of the eight
    merchant_ids_returned = [m["merchant_id"] for m in data["top_merchants"]]
    assert merchant_ids_returned == [base_merchant["id"], *[merchants[i]["id"] for i in range(4)]]
    merchant_totals = [m["total"] for m in data["top_merchants"]]
    assert merchant_totals == [310_000, *[8000 - i * 100 for i in range(4)]]


async def test_exactly_five_entries_yields_zero_other_counts(client):
    """With exactly 5 distinct categories and merchants, other_*_count is 0."""
    headers, account_id = await _setup_account(client)

    today = _today_utc().isoformat()
    for i in range(5):
        cat = (await _create_category(client, headers, name=f"Test Cat {i}")).json()
        merch = (await _create_merchant(client, headers, name=f"Test Merchant {i}")).json()
        await _create_transaction(
            client, headers, account_id, cat["id"],
            dt=today, amount=-(500 - i * 50),
            merchant_id=merch["id"],
        )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    assert len(data["top_categories"]) == 5
    assert len(data["top_merchants"]) == 5
    assert data["other_categories_count"] == 0
    assert data["other_merchants_count"] == 0


# --- Sign handling: refunds and foreign currency ---


async def test_positive_amount_on_expense_category_subtracts_from_total(client):
    """A refund (positive amount on an expense category) reduces grand_total_spend

    The service flips the raw SUM's sign, so a -1000 expense plus a +200 refund
    sums to -800 in the DB and returns 800 — the net expense. This locks in the
    refund semantics and documents that grand_total_spend can go negative if
    refunds exceed charges
    """
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()
    merchant = (await _create_merchant(client, headers)).json()

    today = _today_utc().isoformat()
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today, amount=-1000, merchant_id=merchant["id"],
    )
    # Refund on the same expense category
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today, amount=200, merchant_id=merchant["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["grand_total_spend"] == 800
    assert data["top_categories"][0]["total"] == 800
    assert data["top_merchants"][0]["total"] == 800


async def test_zero_sum_category_and_merchant_are_excluded(client):
    """A fully refunded category/merchant does not appear in spending rows."""
    headers, account_id = await _setup_account(client)
    zero_category = (await _create_category(client, headers, name="Test OLG")).json()
    spend_category = (await _create_category(client, headers, name="Test Groceries Net")).json()
    zero_merchant = (await _create_merchant(client, headers, name="OLG")).json()
    spend_merchant = (await _create_merchant(client, headers, name="Sobeys")).json()

    today = _today_utc().isoformat()
    await _create_transaction(
        client, headers, account_id, zero_category["id"],
        dt=today, amount=-500, merchant_id=zero_merchant["id"],
    )
    await _create_transaction(
        client, headers, account_id, zero_category["id"],
        dt=today, amount=500, merchant_id=zero_merchant["id"],
    )
    await _create_transaction(
        client, headers, account_id, spend_category["id"],
        dt=today, amount=-1200, merchant_id=spend_merchant["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["grand_total_spend"] == 1200
    assert [c["category_id"] for c in data["top_categories"]] == [spend_category["id"]]
    assert [m["merchant_id"] for m in data["top_merchants"]] == [spend_merchant["id"]]
    assert data["top_categories"][0]["total"] == 1200
    assert data["top_merchants"][0]["total"] == 1200
    assert data["other_categories_count"] == 0
    assert data["other_merchants_count"] == 0


async def test_over_refunded_category_and_merchant_are_excluded(client):
    """A category refunded past zero is not spending, so neither it nor its merchant is listed."""
    headers, account_id = await _setup_account(client)
    groceries = (await _create_category(client, headers, name="Test Groceries Refunded")).json()
    rent = (await _create_category(client, headers, name="Test Rent")).json()
    grocer = (await _create_merchant(client, headers, name="Sobeys")).json()
    landlord = (await _create_merchant(client, headers, name="Landlord")).json()

    today = _today_utc().isoformat()
    await _create_transaction(
        client, headers, account_id, groceries["id"],
        dt=today, amount=-10_000, merchant_id=grocer["id"],
    )
    await _create_transaction(
        client, headers, account_id, groceries["id"],
        dt=today, amount=15_000, merchant_id=grocer["id"],
    )
    await _create_transaction(
        client, headers, account_id, rent["id"],
        dt=today, amount=-200_000, merchant_id=landlord["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert [c["category_id"] for c in data["top_categories"]] == [rent["id"]]
    assert [m["merchant_id"] for m in data["top_merchants"]] == [landlord["id"]]


async def test_over_refunded_merchant_inside_a_spending_category_is_excluded(client):
    """A merchant refunded past zero drops out even while its category still nets spending."""
    headers, account_id = await _setup_account(client)
    dining = (await _create_category(client, headers, name="Test Dining")).json()
    refunded_merchant = (await _create_merchant(client, headers, name="Returned Bistro")).json()
    kept_merchant = (await _create_merchant(client, headers, name="Kept Bistro")).json()

    today = _today_utc().isoformat()
    await _create_transaction(
        client, headers, account_id, dining["id"],
        dt=today, amount=-5_000, merchant_id=refunded_merchant["id"],
    )
    await _create_transaction(
        client, headers, account_id, dining["id"],
        dt=today, amount=8_000, merchant_id=refunded_merchant["id"],
    )
    await _create_transaction(
        client, headers, account_id, dining["id"],
        dt=today, amount=-20_000, merchant_id=kept_merchant["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert [c["category_id"] for c in data["top_categories"]] == [dining["id"]]
    assert data["top_categories"][0]["total"] == 17_000
    assert [m["merchant_id"] for m in data["top_merchants"]] == [kept_merchant["id"]]


async def test_merchant_is_judged_on_its_own_net_across_categories(client):
    """A merchant qualifies on its own net, even where one category behind it was refunded past zero."""
    headers, account_id = await _setup_account(client)
    groceries = (await _create_category(client, headers, name="Test Groceries Crossover")).json()
    dining = (await _create_category(client, headers, name="Test Dining Crossover")).json()
    merchant = (await _create_merchant(client, headers, name="Sobeys")).json()

    today = _today_utc().isoformat()
    await _create_transaction(
        client, headers, account_id, groceries["id"],
        dt=today, amount=-10_000, merchant_id=merchant["id"],
    )
    await _create_transaction(
        client, headers, account_id, groceries["id"],
        dt=today, amount=15_000, merchant_id=merchant["id"],
    )
    await _create_transaction(
        client, headers, account_id, dining["id"],
        dt=today, amount=-20_000, merchant_id=merchant["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    # Groceries netted positive and drops out, while the merchant keeps the 50.00 refund against
    # its own 300.00 of purchases and is listed at 150.00
    assert [c["category_id"] for c in data["top_categories"]] == [dining["id"]]
    assert data["top_categories"][0]["total"] == 20_000
    assert [m["merchant_id"] for m in data["top_merchants"]] == [merchant["id"]]
    assert data["top_merchants"][0]["total"] == 15_000


async def test_hidden_category_count_excludes_over_refunded_categories(client):
    """The "and N more" figure counts only categories that still net spending."""
    headers, account_id = await _setup_account(client)
    today = _today_utc().isoformat()

    for index, amount in enumerate((-6_000, -5_000, -4_000, -3_000, -2_000, -1_000)):
        category = (await _create_category(client, headers, name=f"Test Spend {index}")).json()
        await _create_transaction(client, headers, account_id, category["id"], dt=today, amount=amount)

    for index in range(2):
        refunded = (await _create_category(client, headers, name=f"Test Refunded {index}")).json()
        await _create_transaction(client, headers, account_id, refunded["id"], dt=today, amount=-100)
        await _create_transaction(client, headers, account_id, refunded["id"], dt=today, amount=500)

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert [c["total"] for c in data["top_categories"]] == [6_000, 5_000, 4_000, 3_000, 2_000]

    # Six categories still net spending, so one sits behind the visible five
    assert data["other_categories_count"] == 1


async def test_hidden_merchant_count_excludes_over_refunded_merchants(client):
    """The merchant "and N more" figure counts only merchants that still net spending."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers, name="Test Everything")).json()
    today = _today_utc().isoformat()

    for index, amount in enumerate((-8_000, -7_000, -6_000, -5_000, -4_000, -3_000, -2_000, -1_000)):
        merchant = (await _create_merchant(client, headers, name=f"Spender {index}")).json()
        await _create_transaction(
            client, headers, account_id, category["id"],
            dt=today, amount=amount, merchant_id=merchant["id"],
        )

    for index in range(2):
        refunded = (await _create_merchant(client, headers, name=f"Returner {index}")).json()
        await _create_transaction(
            client, headers, account_id, category["id"],
            dt=today, amount=-100, merchant_id=refunded["id"],
        )
        await _create_transaction(
            client, headers, account_id, category["id"],
            dt=today, amount=500, merchant_id=refunded["id"],
        )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert [m["total"] for m in data["top_merchants"]] == [8_000, 7_000, 6_000, 5_000, 4_000]

    # Eight merchants still net spending, so three sit behind the visible five
    assert data["other_merchants_count"] == 3


async def test_mixed_currency_transactions_are_summed_as_raw_minor_units(client):
    """Endpoint sums all expense rows regardless of currency — no fx conversion

    Locks in current behaviour for a future fx-aware change to catch. The account
    is CAD and a USD transaction (with fx_rate to satisfy POST /transactions'
    cross-currency guard) is posted alongside a CAD one; both contribute their
    raw minor-unit amounts to grand_total_spend
    """
    await _seed_usd_currency()

    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    today = _today_utc().isoformat()
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today, amount=-1000, currency="CAD",
    )
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today, amount=-500, currency="USD", fx_rate=1.37,
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    # Raw mix: 1000 + 500 = 1500 (no fx applied)
    assert data["grand_total_spend"] == 1500
    assert data["top_categories"][0]["total"] == 1500


# --- Boundary cases ---


async def test_future_dated_transaction_is_excluded_from_range(client):
    """A transaction dated after today does not contribute — range ends at today."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    today = _today_utc()
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today.isoformat(), amount=-1000,
    )
    # Tomorrow — must be excluded regardless of how wide the range is
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=(today + timedelta(days=1)).isoformat(), amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "YTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["grand_total_spend"] == 1000
    assert data["top_categories"][0]["total"] == 1000


# --- Cross-account isolation ---


async def test_transactions_on_other_accounts_are_excluded(client):
    """Only the queried account's expenses contribute — a sibling account's rows don't leak."""
    headers, account_id = await _setup_account(client)
    other_account_id = (await _create_account(
        client, headers, name="Secondary Chequing",
    )).json()["id"]
    category = (await _create_category(client, headers)).json()
    merchant = (await _create_merchant(client, headers)).json()

    today = _today_utc().isoformat()
    # Transaction on the queried account
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today, amount=-1000, merchant_id=merchant["id"],
    )
    # Transaction on the other account — same user, same category, same merchant
    await _create_transaction(
        client, headers, other_account_id, category["id"],
        dt=today, amount=-8888, merchant_id=merchant["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["grand_total_spend"] == 1000
    assert len(data["top_categories"]) == 1
    assert data["top_categories"][0]["total"] == 1000
    assert len(data["top_merchants"]) == 1
    assert data["top_merchants"][0]["total"] == 1000


# --- Unicode names round-trip ---


async def test_unicode_category_and_merchant_names_round_trip(client):
    """Non-ASCII characters in category and merchant names are preserved in the response."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(
        client, headers, name="Épicerie Métro 🛒",
    )).json()
    merchant = (await _create_merchant(
        client, headers, name="Café Noir ☕",
    )).json()

    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=_today_utc().isoformat(), amount=-1000, merchant_id=merchant["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["top_categories"][0]["name"] == "Épicerie Métro 🛒"
    assert data["top_merchants"][0]["name"] == "Café Noir ☕"


# --- Ordering ---


async def test_categories_and_merchants_are_ordered_largest_spend_first(client):
    """Breakdowns are returned biggest-spend-first."""
    headers, account_id = await _setup_account(client)

    today = _today_utc().isoformat()
    small_cat = (await _create_category(client, headers, name="Test Small")).json()
    medium_cat = (await _create_category(client, headers, name="Test Medium")).json()
    large_cat = (await _create_category(client, headers, name="Test Large")).json()

    small_merch = (await _create_merchant(client, headers, name="Test Small Merch")).json()
    medium_merch = (await _create_merchant(client, headers, name="Test Medium Merch")).json()
    large_merch = (await _create_merchant(client, headers, name="Test Large Merch")).json()

    # Insert in a scrambled order to make sure ordering is from SQL, not insertion order
    await _create_transaction(
        client, headers, account_id, medium_cat["id"],
        dt=today, amount=-2000, merchant_id=medium_merch["id"],
    )
    await _create_transaction(
        client, headers, account_id, small_cat["id"],
        dt=today, amount=-500, merchant_id=small_merch["id"],
    )
    await _create_transaction(
        client, headers, account_id, large_cat["id"],
        dt=today, amount=-5000, merchant_id=large_merch["id"],
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    category_ids_returned = [c["category_id"] for c in data["top_categories"]]
    assert category_ids_returned == [large_cat["id"], medium_cat["id"], small_cat["id"]]
    category_totals = [c["total"] for c in data["top_categories"]]
    assert category_totals == [5000, 2000, 500]

    merchant_ids_returned = [m["merchant_id"] for m in data["top_merchants"]]
    assert merchant_ids_returned == [large_merch["id"], medium_merch["id"], small_merch["id"]]
    merchant_totals = [m["total"] for m in data["top_merchants"]]
    assert merchant_totals == [5000, 2000, 500]


# --- Empty state ---


async def test_empty_state_returns_200_with_zeros_and_empty_lists(client):
    """An account with no expense transactions in range returns 200 and empty payload."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["range"] == "MTD"
    assert data["top_categories"] == []
    assert data["top_merchants"] == []
    assert data["grand_total_spend"] == 0
    assert data["other_categories_count"] == 0
    assert data["other_merchants_count"] == 0


# --- Default range + invalid input ---


async def test_missing_range_param_defaults_to_mtd(client):
    """Omitting ?range= returns an MTD breakdown."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    today = _today_utc()
    month_start = _range_start("MTD", today)
    # In-range today
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today.isoformat(), amount=-1000,
    )
    # Out of MTD but within YTD — a prior-month transaction. If the default
    # were YTD this would be included; MTD default should exclude it
    prior_month_day = month_start - timedelta(days=1)
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=prior_month_day.isoformat(), amount=-9999,
    )

    resp = await client.get(f"/accounts/{account_id}/spending-breakdown", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["range"] == "MTD"
    assert data["grand_total_spend"] == 1000


async def test_invalid_range_param_returns_422(client):
    """An unknown range value is rejected by Pydantic validation."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "foo"},
        headers=headers,
    )
    assert resp.status_code == 422


# --- Auth and permissions ---


async def test_unauthenticated_request_returns_401(client):
    """A request without an auth token is rejected before reaching the handler."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/spending-breakdown")
    assert resp.status_code == 401


async def test_nonexistent_account_returns_404(client):
    """An unknown account UUID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        f"/accounts/{NONEXISTENT_ID}/spending-breakdown",
        headers=headers,
    )
    assert resp.status_code == 404


async def test_other_users_personal_account_returns_404(client):
    """A second user cannot probe another user's personal account — returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    account_id = account_resp.json()["id"]

    other_headers, _ = await _create_second_user(client)

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        headers=other_headers,
    )
    assert resp.status_code == 404


async def test_group_member_without_read_permission_returns_404(client):
    """A group member without explicit permission on the account gets 404, not 403."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        headers=member_headers,
    )
    assert resp.status_code == 404


async def test_group_member_with_explicit_read_permission_succeeds(client):
    """A group member granted explicit READ on an account can fetch the breakdown."""
    signup_resp = await _create_user(client)
    admin_headers = _get_auth_header(signup_resp)

    group_id = await _create_group(client, admin_headers)
    account_resp = await _create_account(client, admin_headers, group_id=group_id)
    account_id = account_resp.json()["id"]

    member_headers, member_user_id = await _create_second_user(client)
    await client.post(
        f"/groups/{group_id}/members",
        json={"user_id": member_user_id},
        headers=admin_headers,
    )
    grant_resp = await _grant_account_permission(
        client, admin_headers, account_id, member_user_id, "read",
    )
    assert grant_resp.status_code == 201

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        headers=member_headers,
    )
    assert resp.status_code == 200


async def test_closed_account_still_returns_breakdown(client):
    """Closed accounts remain readable — the handler does not require require_open."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=_today_utc().isoformat(), amount=-1000,
    )

    close_resp = await client.patch(
        f"/accounts/{account_id}",
        json={"closed_at": "2026-04-01"},
        headers=headers,
    )
    assert close_resp.status_code == 200

    resp = await client.get(
        f"/accounts/{account_id}/spending-breakdown",
        params={"range": "MTD"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["grand_total_spend"] == 1000
