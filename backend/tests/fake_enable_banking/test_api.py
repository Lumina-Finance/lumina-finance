"""The fake Enable Banking's own tests

Guards what the browser tests and a dev instance rely on it for: a scenario's private key reaches only that
scenario, the bank's page sends the browser back with a code and the state or with an error, a code opens
a session once, a range includes both its days, a continuation key leads through every page, a session
can be expired and an account can ask for the user again, and the sample scenario has transactions inside
any recent import range, a card and a pending one
"""

from datetime import UTC, date, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest

REDIRECT_URL = "https://app.example/settings/bank-authorization"


def _headers(scenario: dict) -> dict[str, str]:
    """Return the header that carries a token the scenario's private key signed"""
    now = datetime.now(UTC)
    claims = {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + timedelta(minutes=10)}
    token = jwt.encode(claims, scenario["private_key"], algorithm="RS256", headers={"kid": scenario["application_id"]})
    return {"Authorization": f"Bearer {token}"}


async def _new_scenario(client: httpx.AsyncClient, path: str = "") -> dict:
    """Create a scenario and return its credentials"""
    response = await client.post(f"/control/scenarios{path}")
    assert response.status_code == 201
    return response.json()


async def _sign_in(client: httpx.AsyncClient, scenario: dict, *, approve: bool = True) -> httpx.Response:
    """Start a sign-in, open the bank's page and answer it, returning the redirect the browser is sent on"""
    headers = _headers(scenario)
    started = await client.post(
        "/auth",
        headers=headers,
        json={
            "access": {"valid_until": "2027-01-01T00:00:00Z"},
            "aspsp": {"name": scenario["bank"], "country": scenario["country"]},
            "state": "the-state",
            "redirect_url": REDIRECT_URL,
        },
    )
    assert started.status_code == 200
    page = urlsplit(started.json()["url"]).path
    assert (await client.get(page)).status_code == 200
    return await client.get(f"{page}/{'approve' if approve else 'decline'}")


async def _open_session(client: httpx.AsyncClient, scenario: dict) -> dict:
    """Sign in at the bank and exchange the code for a session"""
    redirect = await _sign_in(client, scenario)
    code = parse_qs(urlsplit(redirect.headers["location"]).query)["code"][0]
    session = await client.post("/sessions", headers=_headers(scenario), json={"code": code})
    assert session.status_code == 200
    return session.json()


async def test_a_private_key_reaches_only_its_own_scenario(enable_banking):
    """Two applications on one fake never see each other's banks, and a request with no token or a forged one is refused"""
    first = await _new_scenario(enable_banking)
    second = (await enable_banking.post("/control/scenarios", json={"bank_name": "Other Bank", "country": "DE"})).json()

    own = await enable_banking.get("/aspsps", headers=_headers(first))
    theirs = await enable_banking.get("/aspsps", headers=_headers(second))
    forged = await enable_banking.get("/aspsps", headers=_headers({**second, "application_id": first["application_id"]}))
    no_token = await enable_banking.get("/aspsps")

    assert [bank["name"] for bank in own.json()["aspsps"]] == ["Aurora Bank"]
    assert [bank["name"] for bank in theirs.json()["aspsps"]] == ["Other Bank"]
    assert (forged.status_code, forged.json()["error"]) == (401, "UNAUTHORIZED_ACCESS")
    assert no_token.status_code == 401


@pytest.mark.parametrize("missing", ["exp", "iat"])
async def test_a_token_without_an_expiry_or_an_issue_time_is_refused(enable_banking, missing):
    """Enable Banking needs both claims, so a client that signs a token without one fails here as it would there"""
    scenario = await _new_scenario(enable_banking)
    now = datetime.now(UTC)
    claims = {"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + timedelta(minutes=10)}
    del claims[missing]
    token = jwt.encode(claims, scenario["private_key"], algorithm="RS256", headers={"kid": scenario["application_id"]})

    refused = await enable_banking.get("/aspsps", headers={"Authorization": f"Bearer {token}"})

    assert refused.status_code == 401


async def test_the_bank_page_sends_the_browser_back_with_a_code_and_the_state_or_with_an_error(enable_banking):
    """Approving returns a code, declining returns access_denied, and both carry the state the app started with"""
    scenario = await _new_scenario(enable_banking)

    approved = await _sign_in(enable_banking, scenario)
    declined = await _sign_in(enable_banking, scenario, approve=False)

    approved_url, declined_url = urlsplit(approved.headers["location"]), urlsplit(declined.headers["location"])
    assert (approved.status_code, f"{approved_url.scheme}://{approved_url.netloc}{approved_url.path}") == (303, REDIRECT_URL)
    assert set(parse_qs(approved_url.query)) == {"code", "state"}
    assert parse_qs(approved_url.query)["state"] == ["the-state"]
    assert parse_qs(declined_url.query) == {"error": ["access_denied"], "state": ["the-state"]}


async def test_a_code_opens_a_session_once_and_the_session_can_be_ended(enable_banking):
    """A second exchange of the same code is refused, and an ended session refuses its accounts"""
    scenario = await _new_scenario(enable_banking, "/sample")
    redirect = await _sign_in(enable_banking, scenario)
    code = parse_qs(urlsplit(redirect.headers["location"]).query)["code"][0]
    headers = _headers(scenario)

    opened = await enable_banking.post("/sessions", headers=headers, json={"code": code})
    again = await enable_banking.post("/sessions", headers=headers, json={"code": code})
    session = opened.json()
    uid = session["accounts"][0]["uid"]
    ended = await enable_banking.delete(f"/sessions/{session['session_id']}", headers=headers)
    refused = await enable_banking.get(f"/accounts/{uid}/balances", headers=headers)

    assert [account["details"] for account in session["accounts"]] == ["Everyday", "Visa Gold"]
    assert (again.status_code, again.json()["error"]) == (422, "WRONG_AUTHORIZATION_CODE")
    assert ended.status_code == 200
    assert (refused.status_code, refused.json()["error"]) == (401, "CLOSED_SESSION")


async def test_a_redirect_address_the_application_did_not_register_is_refused(enable_banking):
    """Once a scenario lists its redirect URLs, a sign-in for another address is refused as Enable Banking does"""
    scenario = await _new_scenario(enable_banking)
    await enable_banking.patch(f"/control/scenarios/{scenario['id']}", json={"redirect_urls": ["https://other.example/back"]})

    started = await enable_banking.post(
        "/auth",
        headers=_headers(scenario),
        json={
            "access": {"valid_until": "2027-01-01T00:00:00Z"},
            "aspsp": {"name": scenario["bank"], "country": scenario["country"]},
            "state": "s",
            "redirect_url": REDIRECT_URL,
        },
    )

    assert (started.status_code, started.json()["error"]) == (422, "REDIRECT_URI_NOT_ALLOWED")


async def test_a_range_includes_both_its_days_and_a_continuation_key_leads_through_every_page(enable_banking):
    """Transactions on the first and last day are in, the day outside is out, and pages of two cover all four"""
    scenario = await _new_scenario(enable_banking)
    added = await enable_banking.post(f"/control/scenarios/{scenario['id']}/accounts", json={"name": "Everyday"})
    account_id = added.json()["id"]
    await enable_banking.post(
        f"/control/scenarios/{scenario['id']}/accounts/{account_id}/transactions",
        json={
            "transactions": [
                {"amount": "1.00", "booking_date": day, "id": day}
                for day in ("2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05")
            ]
        },
    )
    await enable_banking.patch(f"/control/scenarios/{scenario['id']}", json={"page_size": 2})
    session = await _open_session(enable_banking, scenario)
    uid = session["accounts"][0]["uid"]

    seen, key = [], None
    while True:
        query = {"date_from": "2026-10-01", "date_to": "2026-10-04", **({"continuation_key": key} if key else {})}
        page = (await enable_banking.get(f"/accounts/{uid}/transactions", params=query, headers=_headers(scenario))).json()
        seen += [item["entry_reference"] for item in page["transactions"]]
        key = page["continuation_key"]
        if key is None:
            break

    assert seen == ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]


async def test_a_bank_sharing_90_days_refuses_older_dates_but_gives_the_longest_strategy_what_it_still_shares(enable_banking):
    """As Enable Banking documents it: the default strategy answers WRONG_TRANSACTIONS_PERIOD, and the longest strategy ignores date_to"""
    scenario = await _new_scenario(enable_banking)
    added = await enable_banking.post(f"/control/scenarios/{scenario['id']}/accounts", json={"name": "Everyday"})
    today = date.today()
    days = {name: (today - timedelta(days=ago)).isoformat() for name, ago in (("old", 200), ("recent", 30), ("today", 0))}
    await enable_banking.post(
        f"/control/scenarios/{scenario['id']}/accounts/{added.json()['id']}/transactions",
        json={"transactions": [{"amount": "1.00", "booking_date": day, "id": name} for name, day in days.items()]},
    )
    await enable_banking.patch(f"/control/scenarios/{scenario['id']}", json={"history_days": 90})
    session = await _open_session(enable_banking, scenario)
    path = f"/accounts/{session['accounts'][0]['uid']}/transactions"
    since = (today - timedelta(days=365)).isoformat()

    refused = await enable_banking.get(path, params={"date_from": since, "date_to": days["recent"]}, headers=_headers(scenario))
    longest = await enable_banking.get(
        path, params={"date_from": since, "date_to": days["recent"], "strategy": "longest"}, headers=_headers(scenario)
    )

    assert (refused.status_code, refused.json()["error"]) == (422, "WRONG_TRANSACTIONS_PERIOD")
    assert [item["entry_reference"] for item in longest.json()["transactions"]] == ["recent", "today"]


async def test_expired_sessions_and_accounts_asking_for_the_user_again_are_refused_as_the_bank_does(enable_banking):
    """The controls the browser tests use reach the next read: an expired session and a bank wanting a new sign-in"""
    scenario = await _new_scenario(enable_banking, "/sample")
    session = await _open_session(enable_banking, scenario)
    first, second = (account["uid"] for account in session["accounts"])
    await enable_banking.patch(
        f"/control/scenarios/{scenario['id']}/accounts/{scenario['account_ids'][1]}", json={"error": "ASPSP_PSU_ACTION_REQUIRED"}
    )

    needs_user = await enable_banking.get(f"/accounts/{second}/balances", headers=_headers(scenario))
    await enable_banking.post(f"/control/scenarios/{scenario['id']}/sessions/expire")
    expired = await enable_banking.get(f"/accounts/{first}/balances", headers=_headers(scenario))

    assert (needs_user.status_code, needs_user.json()["error"]) == (400, "ASPSP_PSU_ACTION_REQUIRED")
    assert (expired.status_code, expired.json()["error"]) == (401, "EXPIRED_SESSION")


async def test_the_sample_scenario_has_dated_transactions_a_card_and_a_pending_hold(enable_banking):
    """Both accounts have records in the last 10 days, the card's balance is negative and the hold is pending"""
    scenario = await _new_scenario(enable_banking, "/sample")
    session = await _open_session(enable_banking, scenario)
    since = (datetime.now(UTC) - timedelta(days=10)).date().isoformat()
    headers = _headers(scenario)

    checking = await enable_banking.get(f"/accounts/{session['accounts'][0]['uid']}/transactions", params={"date_from": since}, headers=headers)
    card = await enable_banking.get(f"/accounts/{session['accounts'][1]['uid']}/transactions", params={"date_from": since}, headers=headers)
    balances = await enable_banking.get(f"/accounts/{session['accounts'][1]['uid']}/balances", headers=headers)

    assert len(checking.json()["transactions"]) == 3
    assert [item["status"] for item in card.json()["transactions"]] == ["BOOK", "PDNG"]
    assert balances.json()["balances"][0]["balance_amount"]["amount"] == "-412.40"
