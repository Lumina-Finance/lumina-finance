"""Route tests for choosing which credit accounts count toward the dashboard credit widget."""

import asyncio
from uuid import UUID

from sqlalchemy import func, select, text, update

from app.models.account import AccountBalanceSnapshot
from app.models.base import InstitutionStatus
from app.models.institution import Institution
from app.models.user import User, UserCreditExcludedAccount
from tests.conftest import TestSession
from tests.routes.dashboard._helpers import _owner_local_creation_day
from tests.routes.support import _create_account, _create_user, _get_auth_header, sign_up_confirmed


async def _create_card(client, headers, name, limit, used):
    """Create a CAD credit card with a limit and an amount used, in minor units"""
    card = (
        await _create_account(
            client,
            headers,
            account_kind="revolving",
            account_type="credit_card",
            name=name,
            credit_limit=limit,
        )
    ).json()
    async with TestSession() as session:
        await session.execute(
            update(AccountBalanceSnapshot)
            .where(
                AccountBalanceSnapshot.account_id == UUID(card["id"]),
                AccountBalanceSnapshot.dt == _owner_local_creation_day(card),
            )
            .values(balance=-used),
        )
        await session.commit()
    return card


async def _create_second_user_headers(client):
    """Sign up a second user and return their auth headers"""
    resp = await sign_up_confirmed(
        client,
        {
            "email": "second@example.com",
            "password": "SecurePassword123!",
            "first_name": "Second",
            "tz": "America/Toronto",
            "base_currency": "CAD",
        },
    )
    return _get_auth_header(resp)


async def _count_exclusion_rows():
    """Return how many exclusion rows are stored, whoever owns them"""
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(UserCreditExcludedAccount))


async def test_credit_widget_leaves_out_chosen_accounts_and_keeps_the_choice(client):
    """Leaving a card out drops its limit and balance from the totals on every later load."""
    headers = _get_auth_header(await _create_user(client))
    card_a = await _create_card(client, headers, "Card A", 500_000, 50_000)
    card_b = await _create_card(client, headers, "Card B", 200_000, 150_000)

    before = (await client.get("/dashboard/credit-utilization", headers=headers)).json()
    assert (before["credit_limit_total"], before["credit_used"]) == (700_000, 200_000)
    assert [(a["name"], a["is_counted"]) for a in before["accounts"]] == [("Card A", True), ("Card B", True)]

    put_resp = await client.put(
        "/dashboard/credit-utilization/excluded-accounts",
        json={"account_ids": [card_b["id"]]},
        headers=headers,
    )
    assert put_resp.status_code == 200
    assert (put_resp.json()["credit_limit_total"], put_resp.json()["credit_used"]) == (500_000, 50_000)

    # A second load stands in for the same user opening the dashboard on another device
    after = (await client.get("/dashboard/credit-utilization", headers=headers)).json()
    assert (after["credit_limit_total"], after["credit_used"]) == (500_000, 50_000)
    assert [(a["id"], a["is_counted"]) for a in after["accounts"]] == [(card_a["id"], True), (card_b["id"], False)]

    # The accounts page totals every card through this route, so only the widget's own route follows the choice
    everything = (await client.get("/dashboard/credit", headers=headers)).json()
    assert (everything["credit_limit_total"], everything["credit_used"]) == (700_000, 200_000)


async def test_credit_widget_counts_a_card_added_after_the_choice(client):
    """A card opened after another was left out counts until it is left out too."""
    headers = _get_auth_header(await _create_user(client))
    card_b = await _create_card(client, headers, "Card B", 200_000, 150_000)
    await client.put("/dashboard/credit-utilization/excluded-accounts", json={"account_ids": [card_b["id"]]}, headers=headers)

    await _create_card(client, headers, "Card C", 100_000, 10_000)

    data = (await client.get("/dashboard/credit-utilization", headers=headers)).json()
    assert (data["credit_limit_total"], data["credit_used"]) == (100_000, 10_000)
    assert [(a["name"], a["is_counted"]) for a in data["accounts"]] == [("Card B", False), ("Card C", True)]


async def test_credit_widget_with_every_card_left_out_totals_zero_and_still_lists_them(client):
    """The widget reads as having no credit when nothing counts, yet the cards stay choosable."""
    headers = _get_auth_header(await _create_user(client))
    card = await _create_card(client, headers, "Card A", 500_000, 50_000)

    resp = await client.put("/dashboard/credit-utilization/excluded-accounts", json={"account_ids": [card["id"]]}, headers=headers)

    assert resp.status_code == 200
    data = resp.json()
    assert (data["credit_limit_total"], data["credit_used"]) == (0, 0)
    assert [(a["id"], a["is_counted"]) for a in data["accounts"]] == [(card["id"], False)]


async def test_credit_widget_ignores_left_out_accounts_that_are_deleted_or_not_visible(client):
    """Deleting a card removes its stored choice, and one stored for another user's card changes nothing and survives a save."""
    headers = _get_auth_header(await _create_user(client))
    other_headers = await _create_second_user_headers(client)
    card_a = await _create_card(client, headers, "Card A", 500_000, 50_000)
    deleted_card = await _create_card(client, headers, "Deleted card", 200_000, 150_000)
    other_card = await _create_card(client, other_headers, "Other card", 300_000, 30_000)
    me = (await client.get("/me", headers=headers)).json()
    async with TestSession() as session:
        session.add(UserCreditExcludedAccount(user_id=UUID(me["id"]), account_id=UUID(other_card["id"])))
        await session.commit()
    await client.put("/dashboard/credit-utilization/excluded-accounts", json={"account_ids": [deleted_card["id"]]}, headers=headers)
    assert (await client.delete(f"/accounts/{deleted_card['id']}", headers=headers)).status_code == 204

    data = (await client.get("/dashboard/credit-utilization", headers=headers)).json()
    assert (data["credit_limit_total"], data["credit_used"]) == (500_000, 50_000)
    assert [a["id"] for a in data["accounts"]] == [card_a["id"]]

    await client.put("/dashboard/credit-utilization/excluded-accounts", json={"account_ids": []}, headers=headers)
    assert await _count_exclusion_rows() == 1


async def test_credit_exclusions_refuse_accounts_that_cannot_be_left_out(client):
    """Another user's card is a 404, a non-credit account a 422, and neither changes the saved choice."""
    headers = _get_auth_header(await _create_user(client))
    other_headers = await _create_second_user_headers(client)
    card = await _create_card(client, headers, "Card A", 500_000, 50_000)
    kept_out = await _create_card(client, headers, "Card B", 200_000, 150_000)
    other_card = await _create_card(client, other_headers, "Other card", 300_000, 30_000)
    chequing = (await _create_account(client, headers)).json()
    await client.put(
        "/dashboard/credit-utilization/excluded-accounts",
        json={"account_ids": [kept_out["id"]]},
        headers=headers,
    )

    not_yours = await client.put(
        "/dashboard/credit-utilization/excluded-accounts",
        json={"account_ids": [card["id"], other_card["id"]]},
        headers=headers,
    )
    not_credit = await client.put(
        "/dashboard/credit-utilization/excluded-accounts",
        json={"account_ids": [card["id"], chequing["id"]]},
        headers=headers,
    )

    assert not_yours.status_code == 404
    assert not_yours.json()["detail"] == "Account not found"
    assert not_credit.status_code == 422
    assert not_credit.json()["detail"] == "Only credit accounts with a limit count toward credit utilization"
    saved = (await client.get("/dashboard/credit-utilization", headers=headers)).json()
    assert [(a["id"], a["is_counted"]) for a in saved["accounts"]] == [(card["id"], True), (kept_out["id"], False)]
    assert await _count_exclusion_rows() == 1


async def test_credit_utilization_lists_each_card_with_its_type_and_institution(client):
    """The chooser tells cards apart by type and institution, and a card with no institution carries none."""
    headers = _get_auth_header(await _create_user(client))
    async with TestSession() as session:
        institution = Institution(
            status=InstitutionStatus.CANONICAL,
            name="Test Bank",
            country_code="CA",
            website="https://testbank.example.com",
            logo_url="https://testbank.example.com/logo.png",
        )
        session.add(institution)
        await session.commit()
    with_institution = (
        await _create_account(
            client,
            headers,
            account_kind="revolving",
            account_type="credit_card",
            name="Card A",
            credit_limit=500_000,
            institution_id=str(institution.id),
        )
    ).json()
    without_institution = await _create_card(client, headers, "Card B", 200_000, 150_000)

    data = (await client.get("/dashboard/credit-utilization", headers=headers)).json()

    rows = {a["id"]: a for a in data["accounts"]}
    assert rows[with_institution["id"]]["account_type"] == "credit_card"
    assert rows[with_institution["id"]]["institution"]["name"] == "Test Bank"
    assert rows[with_institution["id"]]["institution"]["logo_url"] == "https://testbank.example.com/logo.png"
    assert rows[without_institution["id"]]["account_type"] == "credit_card"
    assert rows[without_institution["id"]]["institution"] is None


async def test_credit_widget_leaves_out_archived_cards_and_keeps_their_choice(client):
    """An archived card is neither offered nor counted, and its left-out choice returns when it is unarchived."""
    headers = _get_auth_header(await _create_user(client))
    card = await _create_card(client, headers, "Card A", 500_000, 50_000)
    archived = await _create_card(client, headers, "Card B", 200_000, 150_000)
    left_out = await client.put(
        "/dashboard/credit-utilization/excluded-accounts",
        json={"account_ids": [archived["id"]]},
        headers=headers,
    )
    assert left_out.status_code == 200

    archive = await client.patch(f"/accounts/{archived['id']}", json={"is_archived": True}, headers=headers)
    assert archive.status_code == 200
    # A save made while the card is archived lists only the cards still offered
    resave = await client.put("/dashboard/credit-utilization/excluded-accounts", json={"account_ids": []}, headers=headers)
    assert resave.status_code == 200

    utilization = (await client.get("/dashboard/credit-utilization", headers=headers)).json()
    assert (utilization["credit_limit_total"], utilization["credit_used"]) == (500_000, 50_000)
    assert [a["id"] for a in utilization["accounts"]] == [card["id"]]

    unarchive = await client.patch(f"/accounts/{archived['id']}", json={"is_archived": False}, headers=headers)
    assert unarchive.status_code == 200
    restored = (await client.get("/dashboard/credit-utilization", headers=headers)).json()
    assert [(a["id"], a["is_counted"]) for a in restored["accounts"]] == [(card["id"], True), (archived["id"], False)]


async def test_saving_the_choice_refuses_a_card_archived_since_the_list_was_opened(client):
    """A card archived in another tab is refused with its own reason, and the stored choice is untouched."""
    headers = _get_auth_header(await _create_user(client))
    archived = await _create_card(client, headers, "Card A", 500_000, 50_000)
    await client.patch(f"/accounts/{archived['id']}", json={"is_archived": True}, headers=headers)

    resp = await client.put("/dashboard/credit-utilization/excluded-accounts", json={"account_ids": [archived["id"]]}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Card A is archived, so it can't count toward credit utilization"
    assert await _count_exclusion_rows() == 0


async def test_saving_the_choice_refuses_an_account_that_is_not_a_credit_account(client):
    """A chequing account cannot be left out, since it never counts in the first place."""
    headers = _get_auth_header(await _create_user(client))
    chequing = (await _create_account(client, headers, name="Chequing")).json()

    resp = await client.put("/dashboard/credit-utilization/excluded-accounts", json={"account_ids": [chequing["id"]]}, headers=headers)

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Only credit accounts with a limit count toward credit utilization"


async def test_saving_the_choice_waits_for_the_user_row_before_replacing_it(client):
    """A save queues behind a holder of the user's row, so it runs after that holder's change rather than beside it."""
    headers = _get_auth_header(await _create_user(client))
    card = await _create_card(client, headers, "Card A", 500_000, 50_000)
    user_id = UUID((await client.get("/me", headers=headers)).json()["id"])

    request = None
    async with TestSession() as holder:
        # FOR NO KEY UPDATE is the strength the save takes, and it conflicts with every row lock but FOR KEY SHARE.
        # The foreign key checks of the save's own inserts take that weaker lock, so they cannot stand in for the
        # explicit one: a save without it runs straight through
        await holder.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))
        holder_pid = await holder.scalar(text("SELECT pg_backend_pid()"))
        try:
            async with asyncio.timeout(10), TestSession() as observer:
                request = asyncio.create_task(
                    client.put(
                        "/dashboard/credit-utilization/excluded-accounts",
                        json={"account_ids": [card["id"]]},
                        headers=headers,
                    )
                )
                while not request.done() and not await observer.scalar(
                    text("SELECT count(*) FROM pg_stat_activity WHERE :holder_pid = ANY(pg_blocking_pids(pid))"),
                    {"holder_pid": holder_pid},
                ):
                    await asyncio.sleep(0.01)
                assert not request.done()
                await holder.rollback()
                resp = await request
        finally:
            await holder.rollback()
            if request is not None and not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)

    assert resp.status_code == 200
    assert await _count_exclusion_rows() == 1
