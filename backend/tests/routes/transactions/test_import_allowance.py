"""What the allowance check refuses in an import: each kind of record the import creates, asked once with how many it adds

An import saves everything or nothing, so a refusal of any kind answers 403 with the deployment's own
sentence and leaves the account and every other record the import would have created unsaved
"""

import pytest

from app.allowance_hook import AllowanceKind
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.allowance_helpers import ALLOWANCE_REASON, install_check
from tests.routes.transactions._helpers import _get_system_category_id
from tests.routes.transactions._import_helpers import (
    _NEW_MAIN_CHEQUING,
    _chequing_mapping,
    _firefly_row,
    _import_run,
    _list_transactions,
    _open_staged_run,
)

_NEW_HOBBIES = {"source": "Hobbies", "create": {"name": "Hobbies", "kind": "expense"}}

# The import creates one account, one category, one merchant and one tag, each asked for as one
_ROW = {
    "account_source": "Main Chequing",
    "category_source": "Hobbies",
    "dt": "2026-04-10",
    "amount": "-1.00",
    "merchant_name": "Costco",
    "tag_names": ["trip"],
}
_PAYLOAD = {"accounts": [_NEW_MAIN_CHEQUING], "categories": [_NEW_HOBBIES], "merchants": [], "tags": [], "rows": [_ROW]}


async def _account_names(client, headers) -> list[str]:
    """Return the names of the user's accounts"""
    return [account["name"] for account in (await client.get("/accounts", headers=headers)).json()]


@pytest.mark.parametrize(
    "kind",
    [AllowanceKind.ACCOUNT, AllowanceKind.CATEGORY, AllowanceKind.MERCHANT, AllowanceKind.TAG],
    ids=["account", "category", "merchant", "tag"],
)
async def test_import_refused_a_kind_it_creates_saves_nothing_at_all(client, kind):
    """Whichever kind is refused, the new account written before it is rolled back too, and the same import then saves whole"""
    headers = _get_auth_header(await _create_user(client))
    asked = install_check(refused={kind})

    refused = await _import_run(client, headers, _PAYLOAD)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert await _account_names(client, headers) == [], "the account of a refused import was saved"
    assert await _list_transactions(client, headers) == []
    assert [(request.held, request.adding) for request in asked if request.kind == kind] == [(0, 1)], (
        "the import asked once, for how many it adds"
    )

    install_check()
    saved = await _import_run(client, headers, _PAYLOAD)

    assert saved.status_code == 201, saved.text
    assert await _account_names(client, headers) == ["Main Chequing"]


async def test_import_reusing_everything_it_names_never_asks_the_check(client):
    """A second import of the same names reuses the user's account, category, merchant and tag, so it adds nothing to ask about"""
    headers = _get_auth_header(await _create_user(client))
    first = await _import_run(client, headers, _PAYLOAD)
    assert first.status_code == 201, first.text
    asked = install_check()
    payload = {"accounts": [{"source": "Main Chequing", "account_id": (await client.get("/accounts", headers=headers)).json()[0]["id"]}]}
    again = await _import_run(client, headers, {**_PAYLOAD, **payload, "categories": [_NEW_HOBBIES]})

    assert again.status_code == 201, again.text
    assert asked == [], "an import adding no account, category, merchant or tag asked the check"


async def test_import_of_budgets_refused_saves_nothing_at_all(client):
    """A journal import whose budgets are refused leaves the new account it also creates unsaved"""
    headers = _get_auth_header(await _create_user(client))
    groceries_id = await _get_system_category_id(client, headers, "Groceries")
    run_id = await _open_staged_run(
        client,
        headers,
        {
            "accounts": [_chequing_mapping()],
            "categories": [],
            "rows": [
                _firefly_row(
                    type="opening balance",
                    dt="2023-12-31",
                    amount="100.00",
                    source_account=None,
                    source_name='Initial balance for "Everyday Chequing"',
                    destination_account="Everyday Chequing",
                    destination_name=None,
                    category=None,
                )
            ],
        },
        "firefly",
    )
    run_path = f"/transactions/import/runs/{run_id}"
    budget = {
        "name": "Groceries",
        "currency": "CAD",
        "category_sources": [groceries_id],
        "recurrence": None,
        "limits": [{"start": "2023-01-01", "end": "2023-01-31", "amount": "100.00"}],
    }
    staged = await client.put(
        f"{run_path}/budgets",
        json={"categories": [{"source": groceries_id, "category_id": groceries_id}], "budgets": [budget]},
        headers=headers,
    )
    assert staged.status_code == 204, staged.text
    asked = install_check(refused={AllowanceKind.BUDGET})

    refused = await client.post(f"{run_path}/journal/commit", headers=headers)

    assert refused.status_code == 403, refused.text
    assert refused.json()["detail"] == ALLOWANCE_REASON
    assert await _account_names(client, headers) == [], "the account of a refused import was saved"
    assert [(request.held, request.adding) for request in asked if request.kind == AllowanceKind.BUDGET] == [(0, 1)]
