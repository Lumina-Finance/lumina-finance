"""Setting up a Canadian user holding records in US dollars, which the installed check then keeps read-only"""

from app.allowance_hook import AllowanceKind, AllowanceRequest
from tests.routes.support import _create_account, _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import install_check, seed_usd_currency
from tests.routes.support.transaction_helpers import _create_transaction, _get_system_category_id


async def _sign_up_holding_usd(client) -> dict:
    """Sign up a user whose main currency is the Canadian dollar, with the US dollar available, and return their auth headers"""
    headers = _get_auth_header(await _create_user(client))
    await seed_usd_currency()
    return headers


async def _new_account(client, headers, name: str, currency: str = "USD", **fields) -> str:
    """Create an account, in US dollars unless told otherwise, and return its id"""
    created = await _create_account(client, headers, name=name, currency=currency, **fields)
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _new_transaction(client, headers, account_id: str, currency: str = "USD", category_id: str | None = None, **fields) -> str:
    """Add a $50 transaction to the account, filed under Groceries and in US dollars unless told otherwise, and return its id"""
    category_id = category_id or await _get_system_category_id(client, headers)
    created = await _create_transaction(client, headers, account_id, category_id, currency=currency, **fields)
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _refuse_other_currencies() -> list[AllowanceRequest]:
    """Install a check refusing records in another currency, and return the requests it is asked"""
    return install_check(refused={AllowanceKind.FOREIGN_CURRENCIES})


def _currency_asks(asked: list[AllowanceRequest]) -> int:
    """Return how often the check was asked about records in another currency"""
    return [request.kind for request in asked].count(AllowanceKind.FOREIGN_CURRENCIES)
