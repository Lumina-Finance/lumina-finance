from datetime import UTC, datetime

from tests.routes.dashboard._helpers import _create_category, _create_transaction, _FixedClock
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.bank_sync_helpers import BANK_DATE, _record_bank_source
from tests.routes.support.query_helpers import _get_with_selects


async def test_recent_activity_carries_each_transactions_bank_source(client, monkeypatch):
    """The dashboard marks a bank-imported transaction the way the transaction list does"""
    from app.routes import dashboard as dashboard_routes

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 10, 4, 16, 0, tzinfo=UTC)))
    headers = _get_auth_header(await _create_user(client))
    account_id = (await _create_account(client, headers, name="Everyday")).json()["id"]
    category_id = (await _create_category(client, headers)).json()["id"]
    manual = await _create_transaction(client, headers, account_id, category_id, dt="2026-10-02", amount=-3000)
    imported = await _create_transaction(client, headers, account_id, category_id, dt=BANK_DATE.isoformat(), amount=-1000)
    await _record_bank_source(imported.json()["id"], bank_amount=-1250)

    body, selects = await _get_with_selects(client, "/dashboard/recent-activity", headers)

    sources = {row["id"]: row["bank_source"] for row in body["recent_transactions"]}
    # The sources come in the read of the recent transactions themselves
    assert [statement.startswith("SELECT transactions.") for statement in selects if "bank_transactions" in statement] == [True]
    assert sources[manual.json()["id"]] is None
    assert sources[imported.json()["id"]]["provider_name"] == "Fake Bank"
    assert sources[imported.json()["id"]]["bank_values"]["amount"] == -1250
    assert sources[imported.json()["id"]]["edited_fields"] == ["amount"]
