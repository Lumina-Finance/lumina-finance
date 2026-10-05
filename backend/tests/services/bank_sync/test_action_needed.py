"""Reading what the user has to do for each account's sync to resume, as the account's sync status shows it

An account left out shows a sync that silently stopped, one shown needing a bank sign-in while its
connection needs reconnecting sends the user to the wrong fix first, and one no longer linked, or
waiting for its bank account to be chosen, that still asks for a bank sign-in nags about an account
that isn't syncing for that reason
"""

from datetime import UTC, datetime

from sqlalchemy import update

from app.models.bank_connection import BankConnection, BankLinkState
from app.services.bank_sync.action_needed import ActionNeeded, ActionNeededKind, read_actions_needed
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_account, _build_bank_link
from tests.routes.support.identity_helpers import _act_as

_REJECTED_AT = datetime(2026, 10, 2, 9, tzinfo=UTC)
_SIGNIN_SINCE = datetime(2026, 10, 3, 9, tzinfo=UTC)
_UNLINKED_AT = datetime(2026, 9, 30, tzinfo=UTC)


async def _commit_links(connection: BankConnection, **links: dict) -> dict:
    """Commit an account of the connection's owner for each name, linked to a bank account on the connection with the link's fields set as given

    Returns:
        Each account's id, by name
    """
    accounts = {name: _build_account(connection.owner_id, name=name) for name in links}
    async with TestSession() as session:
        session.add_all(accounts.values())
        await session.flush()
        session.add_all(_build_bank_link(accounts[name], connection, f"ACT-{name}", **values) for name, values in links.items())
        await session.commit()
    return {name: account.id for name, account in accounts.items()}


async def _reject(connection: BankConnection) -> None:
    """Commit the connection's credential as rejected at _REJECTED_AT"""
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == connection.id).values(credential_rejected_at=_REJECTED_AT))
        await session.commit()


async def _read_as_owner(connection: BankConnection, account_ids) -> dict:
    """Return what the accounts need, read as the connection's owner under row-level security"""
    async with _act_as(connection.owner_id) as session:
        return await read_actions_needed(session, account_ids)


async def test_read_actions_needed_shows_reconnect_needed_for_every_account_still_linked_through_a_rejected_connection(connections):
    """Everyday, which also waits on a bank sign-in, and Card, waiting for its bank account to be chosen, need a reconnect

    Reconnecting comes before the bank sign-in, and Old, unlinked, needs nothing
    """
    connection = connections[0]
    ids = await _commit_links(
        connection,
        everyday={"signin_needed_since": _SIGNIN_SINCE},
        card={"state": BankLinkState.CHOOSE_ACCOUNT},
        old={"state": BankLinkState.UNLINKED, "unlinked_at": _UNLINKED_AT},
    )
    await _reject(connection)

    assert await _read_as_owner(connection, ids.values()) == {
        ids["everyday"]: ActionNeeded(ActionNeededKind.RECONNECT, _REJECTED_AT),
        ids["card"]: ActionNeeded(ActionNeededKind.RECONNECT, _REJECTED_AT),
    }


async def test_read_actions_needed_shows_bank_sign_in_needed_only_for_an_active_link_waiting_on_one(connections):
    """On a working connection, Everyday waits on a bank sign-in from when it was marked, and nothing else needs one

    Savings syncs, Card waits for its bank account to be chosen again, and Old was unlinked, each
    still carrying a sign-in mark from before
    """
    connection = connections[0]
    ids = await _commit_links(
        connection,
        everyday={"signin_needed_since": _SIGNIN_SINCE},
        savings={},
        card={"state": BankLinkState.CHOOSE_ACCOUNT, "signin_needed_since": _SIGNIN_SINCE},
        old={"state": BankLinkState.UNLINKED, "unlinked_at": _UNLINKED_AT, "signin_needed_since": _SIGNIN_SINCE},
    )

    assert await _read_as_owner(connection, ids.values()) == {ids["everyday"]: ActionNeeded(ActionNeededKind.BANK_LOGIN, _SIGNIN_SINCE)}


async def test_read_actions_needed_reads_nothing_of_another_users_accounts(connections):
    """The second owner asks about the first owner's accounts, which need a reconnect, and learns nothing"""
    connection = connections[0]
    ids = await _commit_links(connection, everyday={})
    await _reject(connection)

    assert await _read_as_owner(connections[1], ids.values()) == {}
