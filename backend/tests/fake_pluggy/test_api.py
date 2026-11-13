"""The fake Pluggy's own tests

Guards what the browser tests and a dev instance rely on it for: a scenario's client ID and secret
reach only that scenario, a revoked secret is refused, a range includes both its days, a cursor leads
through every page, an item can be put into LOGIN_ERROR, and the sample scenario has transactions
inside any recent import range, a foreign-currency card row and a pending one
"""

import base64
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest


async def _new_scenario(pluggy: httpx.AsyncClient, path: str = "") -> dict:
    """Create a scenario and return its id, client ID, secret and item IDs"""
    response = await pluggy.post(f"/control/scenarios{path}")
    assert response.status_code == 201
    return response.json()


async def _sign_in(pluggy: httpx.AsyncClient, scenario: dict) -> dict[str, str]:
    """Sign in with a scenario's client ID and secret and return the header that carries the key"""
    response = await pluggy.post("/auth", json={"clientId": scenario["client_id"], "clientSecret": scenario["client_secret"]})
    assert response.status_code == 200
    return {"X-API-KEY": response.json()["apiKey"]}


async def _add_item_with_account(pluggy: httpx.AsyncClient, scenario: dict, **account) -> tuple[str, str]:
    """Add an item holding a Brazilian real account and return their ids"""
    item = (await pluggy.post(f"/control/scenarios/{scenario['id']}/items", json={})).json()
    added = await pluggy.post(f"/control/scenarios/{scenario['id']}/items/{item['id']}/accounts", json={"name": "Conta"} | account)
    assert added.status_code == 201
    return item["id"], added.json()["id"]


async def test_a_client_id_and_secret_reach_only_their_own_scenario_and_need_both(pluggy):
    """Two applications on one fake never see each other's items, and a pair with one wrong half is refused as Pluggy does"""
    first = await _new_scenario(pluggy)
    second = await _new_scenario(pluggy)
    item_id, _ = await _add_item_with_account(pluggy, first)
    mine = await _sign_in(pluggy, first)
    theirs = await _sign_in(pluggy, second)

    own = await pluggy.get(f"/items/{item_id}", headers=mine)
    other = await pluggy.get(f"/items/{item_id}", headers=theirs)
    wrong_secret = await pluggy.post("/auth", json={"clientId": first["client_id"], "clientSecret": second["client_secret"]})
    no_key = await pluggy.get(f"/items/{item_id}")

    assert (own.status_code, own.json()["id"]) == (200, item_id)
    assert (other.status_code, other.json()["code"], other.json()["codeDescription"]) == (404, 404, "ITEM_NOT_FOUND")
    assert wrong_secret.status_code == 401
    assert wrong_secret.json() | {"errorId": "<id>"} == {
        "message": "client keys are invalid",
        "code": 401,
        "codeDescription": "CLIENT_KEYS_UNAUTHORIZED",
        "errorId": "<id>",
    }
    assert (no_key.status_code, no_key.json()["codeDescription"]) == (403, "API_KEY_MISSING_OR_INVALID")
    wrong_key = await pluggy.get(f"/items/{item_id}", headers={"X-API-KEY": "not-a-key"})
    assert (wrong_key.status_code, wrong_key.json()["codeDescription"]) == (403, "API_KEY_MISSING_OR_INVALID")
    assert UUID(no_key.json()["errorId"]) != UUID(wrong_key.json()["errorId"])


@pytest.mark.parametrize(
    "request_body",
    [
        {"json": {"clientId": "not-a-uuid", "clientSecret": "secret"}},
        {"json": {"clientSecret": "secret"}},
        {"content": b""},
        {"content": b"not json"},
    ],
    ids=["client-id-not-a-uuid", "no-client-id", "empty-body", "not-json"],
)
async def test_a_sign_in_pluggy_cannot_read_is_a_400_that_says_the_client_id_must_be_a_uuid(pluggy, request_body):
    """Live Pluggy answers a client ID that isn't a UUID, or none at all, with a 400 and no code description, not the 401 of an unknown pair"""
    refused = await pluggy.post("/auth", **request_body)

    assert refused.status_code == 400
    assert refused.json()["message"] == "clientId must be a UUID"
    assert refused.json()["code"] == 400
    assert "codeDescription" not in refused.json()
    UUID(refused.json()["errorId"])


async def test_a_revoked_secret_is_refused_at_sign_in_and_for_keys_already_handed_out(pluggy):
    """Rotating the secret in Pluggy turns the next sign-in into a 401 and ends the keys it issued"""
    scenario = await _new_scenario(pluggy)
    item_id, _ = await _add_item_with_account(pluggy, scenario)
    headers = await _sign_in(pluggy, scenario)

    revoked = await pluggy.delete(f"/control/scenarios/{scenario['id']}/secret")
    sign_in = await pluggy.post("/auth", json={"clientId": scenario["client_id"], "clientSecret": scenario["client_secret"]})
    old_key = await pluggy.get(f"/items/{item_id}", headers=headers)

    assert revoked.status_code == 204
    assert sign_in.status_code == 401
    assert old_key.status_code == 403


async def test_an_item_put_into_login_error_shows_its_status_and_execution_status(pluggy):
    """The control call a test uses to make a bank ask for the user again reaches the next read of the item"""
    scenario = await _new_scenario(pluggy)
    item_id, _ = await _add_item_with_account(pluggy, scenario)
    headers = await _sign_in(pluggy, scenario)

    await pluggy.patch(
        f"/control/scenarios/{scenario['id']}/items/{item_id}", json={"status": "LOGIN_ERROR", "execution_status": "INVALID_CREDENTIALS"}
    )
    read = (await pluggy.get(f"/items/{item_id}", headers=headers)).json()

    assert (read["status"], read["executionStatus"]) == ("LOGIN_ERROR", "INVALID_CREDENTIALS")


async def test_transactions_include_both_days_of_the_range_and_follow_a_cursor(pluggy):
    """A day at either end of the range is kept, one outside it is not, and a page size of two leads through the rest by cursor"""
    scenario = await _new_scenario(pluggy)
    _, account_id = await _add_item_with_account(pluggy, scenario)
    await pluggy.patch(f"/control/scenarios/{scenario['id']}", json={"page_size": 2})
    added = await pluggy.post(
        f"/control/scenarios/{scenario['id']}/accounts/{account_id}/transactions",
        json={
            "transactions": [
                {"id": "before", "amount": "-1.00", "date": "2026-09-30T23:59:59.000Z"},
                {"id": "first-day", "amount": "-2.00", "date": "2026-10-01T00:00:00.000Z"},
                {"id": "middle", "amount": "10.07", "date": "2026-10-02T12:00:00.000Z", "description": "Corner Store"},
                {"id": "last-day", "amount": "-4.00", "date": "2026-10-03T23:59:59.000Z"},
                {"id": "after", "amount": "-5.00", "date": "2026-10-04T00:00:00.000Z"},
            ]
        },
    )
    assert added.status_code == 201
    headers = await _sign_in(pluggy, scenario)
    window = {"accountId": account_id, "dateFrom": "2026-10-01", "dateTo": "2026-10-03"}

    first_page = (await pluggy.get("/v2/transactions", params=window, headers=headers)).json()
    follow = first_page["next"]

    # The next query holds no dates, so a client sends its own, as Pluggy's published client does
    second_page = (await pluggy.get(f"/v2/transactions{follow}&dateFrom=2026-10-01&dateTo=2026-10-03", headers=headers)).json()

    assert [item["id"] for item in first_page["results"]] == ["first-day", "middle"]
    assert follow.startswith(f"?accountId={account_id}&after=")
    assert "dateFrom" not in follow
    assert [item["id"] for item in second_page["results"]] == ["last-day"]
    assert second_page["next"] is None
    middle = first_page["results"][1]
    assert (middle["amount"], middle["description"], middle["currencyCode"]) == (10.07, "Corner Store", "BRL")


async def test_the_sample_scenario_holds_a_checking_account_and_a_card_with_recent_transactions(pluggy):
    """An import starting 10 days back finds transactions, the card has a foreign-currency row and a pending one, and charges are positive"""
    scenario = await _new_scenario(pluggy, "/sample")
    headers = await _sign_in(pluggy, scenario)

    [item_id] = scenario["item_ids"]
    item = (await pluggy.get(f"/items/{item_id}", headers=headers)).json()
    listed = (await pluggy.get("/accounts", params={"itemId": item_id}, headers=headers)).json()["results"]
    today = datetime.now(UTC).date()
    window = {"dateFrom": (today - timedelta(days=10)).isoformat(), "dateTo": today.isoformat()}
    reads = {
        account["type"]: (await pluggy.get("/v2/transactions", params={"accountId": account["id"]} | window, headers=headers)).json()["results"]
        for account in listed
    }

    assert (item["status"], item["connector"]["name"]) == ("UPDATED", "Pluggy Bank")
    assert [(account["type"], account["name"]) for account in listed] == [("BANK", "Conta Corrente"), ("CREDIT", "Cartão Pluggy Gold")]
    assert [item["description"] for item in reads["BANK"]] == [
        "COMPRA DEBITO PADARIA SOL NASCENTE",
        "SALARIO BRIGHTWORKS LTDA",
        "COMPRA DEBITO POSTO NORTE",
    ]
    assert [
        (item["description"], item["amount"], item["currencyCode"], item.get("amountInAccountCurrency"), item["status"])
        for item in reads["CREDIT"]
    ] == [
        ("LOJA ONLINE PARCELPOINT", 329.95, "BRL", None, "POSTED"),
        ("CLOUDHOST SUBSCRIPTION", 40.0, "USD", 208.74, "POSTED"),
        ("SUPERMERCADO FRESCOR", 62.0, "BRL", None, "PENDING"),
    ]


async def test_a_cursor_is_opaque_padded_base64_and_a_cursor_the_fake_did_not_hand_out_is_refused(pluggy):
    """Clients must treat the position as text to hand back, never read it, so it is base64 ending in padding, and a made-up one is a 400"""
    scenario = await _new_scenario(pluggy)
    _, account_id = await _add_item_with_account(pluggy, scenario)
    await pluggy.patch(f"/control/scenarios/{scenario['id']}", json={"page_size": 1})
    await pluggy.post(
        f"/control/scenarios/{scenario['id']}/accounts/{account_id}/transactions",
        json={
            "transactions": [
                {"id": "one", "amount": "-1.00", "date": "2026-10-01T00:00:00.000Z"},
                {"id": "two", "amount": "-2.00", "date": "2026-10-02T00:00:00.000Z"},
            ]
        },
    )
    headers = await _sign_in(pluggy, scenario)

    first_page = (await pluggy.get("/v2/transactions", params={"accountId": account_id}, headers=headers)).json()
    after = first_page["next"].split("after=")[1]
    made_up = await pluggy.get("/v2/transactions", params={"accountId": account_id, "after": "cursor_1"}, headers=headers)

    assert after.endswith("==")
    assert base64.b64decode(after, validate=True)
    assert made_up.status_code == 400
    assert (made_up.json()["message"], made_up.json()["code"]) == ("Invalid cursor", 400)


async def test_an_items_accounts_come_on_one_page_whatever_the_transaction_page_size(pluggy):
    """Pluggy publishes no page parameter for accounts, so the list is whole and says it has one page"""
    scenario = await _new_scenario(pluggy)
    item_id, _ = await _add_item_with_account(pluggy, scenario)
    await pluggy.post(f"/control/scenarios/{scenario['id']}/items/{item_id}/accounts", json={"name": "Poupança"})
    await pluggy.patch(f"/control/scenarios/{scenario['id']}", json={"page_size": 1})
    headers = await _sign_in(pluggy, scenario)

    listed = (await pluggy.get("/accounts", params={"itemId": item_id}, headers=headers)).json()

    assert [account["name"] for account in listed["results"]] == ["Conta", "Poupança"]
    assert (listed["total"], listed["totalPages"]) == (2, 1)
