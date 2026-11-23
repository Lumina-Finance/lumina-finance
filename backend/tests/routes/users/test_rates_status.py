"""GET /me/rates-status, the digest a browser compares to learn whether converted figures are out of date

What moves the digest and when it is unknown is tested on the service, so these prove the route joins
a conversion made by another request to the digest, reads through the rate cache and answers only the signed-in user
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from app.allowance_hook import AllowanceKind
from app.models.account import AccountBalanceSnapshot
from app.models.base import Base
from app.models.currency import Currency
from app.routes import dashboard as dashboard_routes
from app.services.fx import FrankfurterProvider, used_pairs
from app.services.fx.rates_status import CONVERTED_CURRENCY_COLUMNS
from tests.conftest import TestSession
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import install_check
from tests.routes.support.authorization_helpers import _sign_up_other_user
from tests.routes.support.clock_helpers import _FixedClock
from tests.routes.support.transaction_helpers import _create_transaction, _get_system_category_id


async def test_rates_status_follows_the_pairs_a_dashboard_request_converted(client, published_valkey, monkeypatch):
    """A user whose request converted USD to CAD gets a digest of those rates, read through the cache, and another user the empty one"""
    calls = []

    async def fake_get_rates(self, base, quote, start_date, end_date):
        calls.append((base, quote, start_date, end_date))
        return {start_date + timedelta(days=offset): Decimal("1.5") for offset in range((end_date - start_date).days + 1)}

    monkeypatch.setattr(dashboard_routes, "datetime", _FixedClock(datetime(2026, 3, 20, 16, 0, tzinfo=UTC)))
    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    headers = _get_auth_header(await _create_user(client))
    other_headers, _other_id = await _sign_up_other_user(client)
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    usd_account = (await _create_account(client, headers, name="USD Cash", currency="USD")).json()
    async with TestSession() as session:
        session.add(AccountBalanceSnapshot(account_id=UUID(usd_account["id"]), dt=date(2026, 3, 20), balance=200_00))
        await session.commit()

    before_any_conversion = await client.get("/me/rates-status", headers=headers)
    assert (await client.get("/dashboard/net-worth", params={"window_days": 2}, headers=headers)).status_code == 200
    calls_before_status = len(calls)
    first = await client.get("/me/rates-status", headers=headers)
    second = await client.get("/me/rates-status", headers=headers)
    other = await client.get("/me/rates-status", headers=other_headers)
    other_again = await client.get("/me/rates-status", headers=other_headers)

    assert before_any_conversion.status_code == 200
    assert before_any_conversion.json() == {"digest": None}, "a USD account needs conversions that aren't recorded yet"
    assert first.status_code == 200
    assert len(first.json()["digest"]) == 64
    assert second.json() == first.json()
    assert len(calls) == calls_before_status + 1, "the second ask reads the rates the first stored"
    assert calls[-1][:2] == ("USD", "CAD")
    assert len(other.json()["digest"]) == 64, "another user holds only their own currency, so their digest is the empty one"
    assert other_again.json() == other.json(), "and it stays equal between visits"
    assert other.json() != first.json()


async def test_rates_status_is_unknown_with_no_recorded_pair_once_a_transaction_holds_another_currency(client, published_valkey, monkeypatch):
    """A recent USD purchase on a CAD account needs a conversion, so an empty record of pairs no longer gives the empty digest"""

    async def fake_get_rates(self, base, quote, start_date, end_date):
        return {start_date + timedelta(days=offset): Decimal("1.5") for offset in range((end_date - start_date).days + 1)}

    monkeypatch.setattr(FrankfurterProvider, "get_rates", fake_get_rates)
    headers = _get_auth_header(await _create_user(client))
    user_id = UUID((await client.get("/me", headers=headers)).json()["id"])
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    account = (await _create_account(client, headers, name="CAD Chequing")).json()
    only_own_currency = await client.get("/me/rates-status", headers=headers)

    category_id = await _get_system_category_id(client, headers)
    today = datetime.now(UTC).date()
    settled = today - timedelta(days=30)
    assert (
        await _create_transaction(client, headers, account["id"], category_id, currency="USD", fx_rate=1.4, dt=settled.isoformat())
    ).status_code == 201
    await published_valkey.client.delete(published_valkey.namespace + used_pairs._key(user_id))
    after_a_settled_purchase = await client.get("/me/rates-status", headers=headers)

    recent = {"currency": "USD", "fx_rate": 1.4, "dt": today.isoformat()}
    assert (await _create_transaction(client, headers, account["id"], category_id, **recent)).status_code == 201
    # The record of pairs expires after 30 days unused, while the purchase stays
    await published_valkey.client.delete(published_valkey.namespace + used_pairs._key(user_id))

    assert len(only_own_currency.json()["digest"]) == 64, "only CAD so far, so the empty digest"
    assert after_a_settled_purchase.json() == only_own_currency.json(), "a month-old purchase converts at a settled rate"
    assert (await client.get("/me/rates-status", headers=headers)).json() == {"digest": None}, (
        "today's USD purchase needs a conversion whose record is gone"
    )


def test_every_stored_currency_is_checked_for_other_currencies():
    """A model gaining a currency column must join the check, or its conversions could hide behind the empty digest"""
    stored = {
        f"{column.table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if any(key.target_fullname == "currencies.id" for key in column.foreign_keys)
    }

    assert stored - {"users.base_currency"} == {
        f"{column.expression.table.name}.{column.expression.name}" for column in CONVERTED_CURRENCY_COLUMNS
    }


async def test_rates_status_requires_sign_in(client):
    """The digest is for a signed-in user, so a request with no token is refused"""
    assert (await client.get("/me/rates-status")).status_code == 401


async def test_rates_status_holds_steady_for_a_user_whose_other_currencies_are_refused(client, published_valkey):
    """A user with a USD account whose conversions the check refuses has no recorded pair, and still gets one digest each visit"""
    headers = _get_auth_header(await _create_user(client))
    async with TestSession() as session:
        session.add(Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2))
        await session.commit()
    assert (await _create_account(client, headers, name="USD Cash", currency="USD")).status_code == 201
    install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})

    first = await client.get("/me/rates-status", headers=headers)
    second = await client.get("/me/rates-status", headers=headers)

    assert first.status_code == 200
    assert len(first.json()["digest"]) == 64
    assert second.json() == first.json()
