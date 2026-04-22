"""Route tests for GET /accounts/{account_id}/cash-flow."""
from datetime import UTC, date, datetime, timedelta

from tests.routes.conftest import _create_account, _create_user, _get_auth_header

# --- Helpers ---

NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000"


def _today_utc() -> date:
    """Return the same "today" the endpoint uses when deriving its month window."""
    return datetime.now(UTC).date()


def _first_of_current_month(today: date) -> date:
    """Return the first of ``today``'s calendar month — the last entry's anchor."""
    return date(today.year, today.month, 1)


def _first_of_prior_month(today: date) -> date:
    """Return the first of the month before ``today``'s month."""
    if today.month == 1:
        return date(today.year - 1, 12, 1)
    return date(today.year, today.month - 1, 1)


def _mid_of_prior_month(today: date) -> date:
    """Return the 15th of the month before ``today``'s month.

    The 15th avoids month-length edge cases (Feb 29 / 30 / 31) when a test
    shifts into the previous month.
    """
    return _first_of_prior_month(today).replace(day=15)


def _first_of_month_n_back(today: date, n: int) -> date:
    """Return the first of the month that is ``n`` months before ``today``'s month."""
    year, month = today.year, today.month
    for _ in range(n):
        if month == 1:
            year -= 1
            month = 12
        else:
            month -= 1
    return date(year, month, 1)


async def _create_category(client, headers, **overrides):
    """Create a category via POST /categories. Defaults to a unique expense category.

    Uses a "Test " prefix so the names don't collide with the default set
    seeded on signup ("Groceries", "Salary", "Transfer", ...).
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
    return await client.post("/transactions", json=payload, headers=headers)


async def _create_second_user(client):
    """Sign up a second user and return (auth_headers, user_id)."""
    resp = await client.post("/auth/signup", json={
        "email": "other@example.com",
        "password": "securepassword123",
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


async def _setup_account(client):
    """Shorthand: create a user, return (headers, account_id)."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)
    account_resp = await _create_account(client, headers)
    return headers, account_resp.json()["id"]


# --- Month sequence: default length, configurable length, ordering, anchoring ---


async def test_default_months_param_returns_six_entries_ending_at_current_month(client):
    """Omitting ?months= returns 6 entries; last entry is the first of the current month."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(f"/accounts/{account_id}/cash-flow", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 6
    assert data[-1]["month"] == _first_of_current_month(_today_utc()).isoformat()


async def test_months_param_three_returns_three_entries(client):
    """?months=3 returns exactly 3 entries."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 3},
        headers=headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 3


async def test_months_param_twelve_returns_twelve_entries(client):
    """?months=12 returns exactly 12 entries."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 12},
        headers=headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 12


async def test_months_param_one_returns_single_current_month_entry(client):
    """?months=1 returns a single entry anchored to the current month."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 1},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["month"] == _first_of_current_month(_today_utc()).isoformat()


async def test_months_param_twenty_four_returns_twenty_four_entries(client):
    """?months=24 (the upper bound) returns exactly 24 entries."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 24},
        headers=headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 24


async def test_series_is_ordered_oldest_first_and_anchored_to_current_month(client):
    """Months are strictly ascending and the last entry is the first of the current UTC month."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    months = [date.fromisoformat(entry["month"]) for entry in data]
    # Last entry anchors to the first of the current UTC month.
    assert months[-1] == _first_of_current_month(_today_utc())
    # Every month is the 1st of its month and each step forward by one month.
    assert all(m.day == 1 for m in months)
    assert all(months[i] < months[i + 1] for i in range(len(months) - 1))


# --- Zero-fill: missing months emit zero ---


async def test_account_with_activity_only_in_current_month_zero_fills_others(client):
    """An account with activity only in the current month returns zeros for the other 5."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=_today_utc().isoformat(), amount=-1500,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 6

    # First 5 entries are all zero.
    for entry in data[:-1]:
        assert entry["income"] == 0
        assert entry["expenses"] == 0
    # Current month shows the expense.
    assert data[-1]["income"] == 0
    assert data[-1]["expenses"] == 1500


# --- Category-kind routing: income vs. expense ---


async def test_income_and_expense_land_in_their_respective_fields(client):
    """An income txn contributes to ``income``; an expense txn contributes to ``expenses``."""
    headers, account_id = await _setup_account(client)
    income_cat = (await _create_category(
        client, headers, name="Test Salary", kind="income",
    )).json()
    expense_cat = (await _create_category(
        client, headers, name="Test Groceries", kind="expense",
    )).json()

    today = _today_utc().isoformat()
    await _create_transaction(
        client, headers, account_id, income_cat["id"],
        dt=today, amount=300_000,
    )
    await _create_transaction(
        client, headers, account_id, expense_cat["id"],
        dt=today, amount=-4500,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    current = data[-1]
    assert current["income"] == 300_000
    assert current["expenses"] == 4500


# --- Transfers: routed by sign just like any other transaction ---


async def test_transfer_transactions_contribute_to_cash_flow_by_sign(client):
    """Transfers are bucketed by amount sign like any other transaction.

    Per-account cash flow reflects real balance movement, so a negative
    transfer (money leaving the account) lands in ``expenses`` and a
    positive transfer (money arriving) lands in ``income``. This is the
    opposite of the household savings-rate widget, which excludes transfers
    because they net to zero across the user's own accounts.
    """
    headers, account_id = await _setup_account(client)
    transfer_cat = (await _create_category(
        client, headers, name="Test Internal Transfer", kind="transfer",
    )).json()
    expense_cat = (await _create_category(
        client, headers, name="Test Groceries", kind="expense",
    )).json()

    today = _today_utc().isoformat()
    # Transfer out — money leaving the account → expenses
    await _create_transaction(
        client, headers, account_id, transfer_cat["id"],
        dt=today, amount=-5000,
    )
    # Transfer in — money arriving at the account → income
    await _create_transaction(
        client, headers, account_id, transfer_cat["id"],
        dt=today, amount=3000,
    )
    # Ordinary expense — also in expenses
    await _create_transaction(
        client, headers, account_id, expense_cat["id"],
        dt=today, amount=-2000,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    current = resp.json()[-1]
    # income = +3000 transfer in
    assert current["income"] == 3000
    # expenses = 5000 transfer out + 2000 expense
    assert current["expenses"] == 7000


# --- Sign handling ---


async def test_expense_amount_is_returned_as_positive_minor_units(client):
    """An expense with amount=-2500 is returned as expenses=2500."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=_today_utc().isoformat(), amount=-2500,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    current = resp.json()[-1]
    assert current["expenses"] == 2500


async def test_negative_amount_on_income_category_routes_to_expenses_by_sign(client):
    """Category kind doesn't steer the bucket — sign does.

    A clawback on an income-kind category (negative amount) shows up as an
    outflow because it really did leave the account. The earlier kind-based
    behaviour would have surfaced a negative number in ``income``; under the
    sign-based model the bucket is driven by amount direction only.
    """
    headers, account_id = await _setup_account(client)
    income_category = (await _create_category(
        client, headers, name="Test Salary", kind="income",
    )).json()

    await _create_transaction(
        client, headers, account_id, income_category["id"],
        dt=_today_utc().isoformat(), amount=-500,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    current = resp.json()[-1]
    assert current["income"] == 0
    assert current["expenses"] == 500


# --- Cross-account isolation ---


async def test_other_accounts_of_the_same_user_do_not_leak_into_the_series(client):
    """An expense on a sibling account must not appear in the queried account's series."""
    headers, account_id = await _setup_account(client)
    other_account_id = (await _create_account(
        client, headers, name="Secondary Chequing",
    )).json()["id"]
    category = (await _create_category(client, headers)).json()

    today = _today_utc().isoformat()
    # Queried account — should appear.
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today, amount=-1000,
    )
    # Other account — same user, same category, must NOT appear.
    await _create_transaction(
        client, headers, other_account_id, category["id"],
        dt=today, amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    current = resp.json()[-1]
    assert current["expenses"] == 1000
    assert current["income"] == 0


# --- Prior-month bucketing ---


async def test_prior_month_transaction_lands_in_second_to_last_entry(client):
    """A transaction in the prior calendar month lands in the second-to-last bucket."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    today = _today_utc()
    # Seed an expense on the 15th of last month (safe across month-length boundaries).
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=_mid_of_prior_month(today).isoformat(), amount=-3000,
    )
    # And a different expense in the current month — confirms both buckets compute independently.
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=today.isoformat(), amount=-700,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()

    # Second-to-last entry is the prior calendar month, anchored to its 1st.
    assert data[-2]["month"] == _first_of_prior_month(today).isoformat()
    assert data[-2]["expenses"] == 3000
    assert data[-2]["income"] == 0
    # Current-month bucket is unaffected.
    assert data[-1]["month"] == _first_of_current_month(today).isoformat()
    assert data[-1]["expenses"] == 700


# --- Out-of-window exclusion ---


async def test_transaction_outside_the_window_does_not_contribute(client):
    """With ?months=3, a transaction 5 months ago is outside the window and excluded."""
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    today = _today_utc()
    out_of_window = _first_of_month_n_back(today, 5).replace(day=15)
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=out_of_window.isoformat(), amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 3},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 3
    # Every bucket stays at zero — the seed falls outside the 3-month window.
    for entry in data:
        assert entry["income"] == 0
        assert entry["expenses"] == 0


async def test_transaction_on_window_start_is_included(client):
    """A transaction dated on the first of the oldest window month is included.

    Window bounds are inclusive on the start; this test guards the hinge at
    window_start itself rather than the comfortable interior.
    """
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    today = _today_utc()
    window_start = _first_of_month_n_back(today, 5)
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=window_start.isoformat(), amount=-1000,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["month"] == window_start.isoformat()
    assert data[0]["expenses"] == 1000


async def test_transaction_on_day_before_window_start_is_excluded(client):
    """A transaction dated one day before the oldest window month is excluded.

    Paired with the prior test to pin down the inclusive/exclusive hinge at
    window_start.
    """
    headers, account_id = await _setup_account(client)
    category = (await _create_category(client, headers)).json()

    today = _today_utc()
    window_start = _first_of_month_n_back(today, 5)
    day_before = window_start - timedelta(days=1)
    await _create_transaction(
        client, headers, account_id, category["id"],
        dt=day_before.isoformat(), amount=-9999,
    )

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    # The seed falls in the month just before the window; every bucket stays zero.
    for entry in data:
        assert entry["income"] == 0
        assert entry["expenses"] == 0


# --- Empty account ---


async def test_empty_account_returns_all_zero_series(client):
    """An account with no transactions returns ``months`` all-zero entries."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 6
    for entry in data:
        assert entry["income"] == 0
        assert entry["expenses"] == 0


# --- Validation ---


async def test_months_param_zero_returns_422(client):
    """?months=0 is rejected by Pydantic validation (ge=1)."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 0},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_months_param_above_cap_returns_422(client):
    """?months=25 is rejected by Pydantic validation (le=24)."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": 25},
        headers=headers,
    )
    assert resp.status_code == 422


async def test_months_param_non_integer_returns_422(client):
    """?months=abc is rejected by Pydantic validation."""
    headers, account_id = await _setup_account(client)

    resp = await client.get(
        f"/accounts/{account_id}/cash-flow",
        params={"months": "abc"},
        headers=headers,
    )
    assert resp.status_code == 422


# --- Auth and permissions ---


async def test_unauthenticated_request_returns_401(client):
    """A request without an auth token is rejected before reaching the handler."""
    resp = await client.get(f"/accounts/{NONEXISTENT_ID}/cash-flow")
    assert resp.status_code == 401


async def test_nonexistent_account_returns_404(client):
    """An unknown account UUID returns 404."""
    signup_resp = await _create_user(client)
    headers = _get_auth_header(signup_resp)

    resp = await client.get(
        f"/accounts/{NONEXISTENT_ID}/cash-flow",
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
        f"/accounts/{account_id}/cash-flow",
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
        f"/accounts/{account_id}/cash-flow",
        headers=member_headers,
    )
    assert resp.status_code == 404


async def test_group_member_with_explicit_read_permission_succeeds(client):
    """A group member granted explicit READ on an account can fetch the series."""
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
        f"/accounts/{account_id}/cash-flow",
        headers=member_headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 6


async def test_closed_account_still_returns_cash_flow(client):
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
        f"/accounts/{account_id}/cash-flow",
        params={"months": 6},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 6
    assert data[-1]["expenses"] == 1000


# --- Unit tests: month sequence helper ---


def test_month_sequence_crosses_year_boundary_correctly():
    """Year rollover: a January anchor produces a sequence that reaches back into the prior year.

    The HTTP layer can't freeze time, so this exercises the private helper
    directly with a fixed ``now`` — the only way to lock in the year-wrap
    logic in ``_month_sequence_ending_at``.
    """
    from app.services.accounts import _month_sequence_ending_at

    now = datetime(2026, 1, 15, tzinfo=UTC)
    result = _month_sequence_ending_at(now, 6)
    assert result == [
        date(2025, 8, 1),
        date(2025, 9, 1),
        date(2025, 10, 1),
        date(2025, 11, 1),
        date(2025, 12, 1),
        date(2026, 1, 1),
    ]
