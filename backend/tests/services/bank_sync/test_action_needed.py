"""What the user has to do for each account's sync to resume: the emails that tell them, and the account's sync status

An account left out shows a sync that silently stopped, and one shown needing a bank sign-in while
its connection needs reconnecting, or shown waiting for its bank account to be chosen while it also
needs a bank sign-in, sends the user to the wrong fix first. One no longer linked that still asks for
a bank sign-in nags about an account that isn't syncing. An email that doesn't say what stopped and what to do leaves
the user guessing, and one carrying the credential or transactions leaks them
"""

from datetime import UTC, datetime

from sqlalchemy import select, update

from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.services.bank_sync.action_needed import (
    ActionNeeded,
    ActionNeededKind,
    choose_account_emails,
    flag_rejected_credential,
    flag_signin_needed,
    read_actions_needed,
)
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import _build_account, _build_bank_link, _build_external_account
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


async def test_read_actions_needed_shows_bank_sign_in_needed_for_each_linked_account_waiting_on_one(connections):
    """On a working connection, Everyday and Card wait on a bank sign-in from when each was marked, and nothing else needs one

    Card also waits for its bank account to be chosen again, which the bank sign-in comes before.
    Savings syncs, and Old was unlinked, still carrying a sign-in mark from before
    """
    connection = connections[0]
    ids = await _commit_links(
        connection,
        everyday={"signin_needed_since": _SIGNIN_SINCE},
        savings={},
        card={"state": BankLinkState.CHOOSE_ACCOUNT, "signin_needed_since": _SIGNIN_SINCE},
        old={"state": BankLinkState.UNLINKED, "unlinked_at": _UNLINKED_AT, "signin_needed_since": _SIGNIN_SINCE},
    )

    assert await _read_as_owner(connection, ids.values()) == {
        ids["everyday"]: ActionNeeded(ActionNeededKind.BANK_LOGIN, _SIGNIN_SINCE),
        ids["card"]: ActionNeeded(ActionNeededKind.BANK_LOGIN, _SIGNIN_SINCE),
    }


async def test_action_emails_say_what_stopped_syncing_and_how_to_resume_it(connections):
    """Each action-needed email as its owner reads it, naming what stopped syncing and what to do, and nothing of the credential or transactions

    Reconnect needed names the connection by the nickname its owner gave it and lists the accounts
    linked through it, or says what to do before linking any. Bank sign-in needed names the bank and
    the site to sign in on, and Choose bank account names the account and the bank account it followed
    """
    family, unlinked = connections[0], connections[1]
    ids = await _commit_links(family, Everyday={}, Card={})
    async with TestSession() as session:
        await session.execute(update(BankConnection).where(BankConnection.id == family.id).values(nickname="Family banks"))
        for name in ("Everyday", "Card"):
            listed = _build_external_account(family, f"ACT-{name}")
            listed.login_key, listed.institution_name = "CON-chase", "Chase"
            session.add(listed)
        await session.commit()

    async with _act_as(family.owner_id) as session:
        connection = await session.get_one(BankConnection, family.id)
        links = (await session.scalars(select(BankAccountLink).where(BankAccountLink.connection_id == family.id))).all()
        everyday = [link for link in links if link.account_id == ids["Everyday"]]
        emails = [
            *await flag_rejected_credential(session, connection, at=_REJECTED_AT),
            *await flag_signin_needed(session, connection, links, at=_SIGNIN_SINCE),
            *await choose_account_emails(session, connection, everyday),
        ]
    async with _act_as(unlinked.owner_id) as session:
        emails += await flag_rejected_credential(session, await session.get_one(BankConnection, unlinked.id), at=_REJECTED_AT)

    assert [(email.recipient, email.message.subject, email.message.text_body) for email in emails] == [
        (
            "owner0@example.com",
            "Reconnect SimpleFIN to resume syncing",
            "SimpleFIN rejected your Family banks connection, so syncing has stopped for:\n\n"
            "- Card\n"
            "- Everyday\n\n"
            "Reconnect it in Settings with a new setup token to pick up where it left off.",
        ),
        (
            "owner0@example.com",
            "Sign in to your bank again in SimpleFIN Bridge",
            "Sign in to Chase again in SimpleFIN Bridge. Until you do, syncing has stopped for:\n\n"
            "- Card\n"
            "- Everyday\n\n"
            "Lumina Finance checks daily and picks up where it left off once you have.",
        ),
        (
            "owner0@example.com",
            "Choose a bank account again to resume syncing",
            "SimpleFIN now lists Everyday Chequing differently, so Lumina Finance can't tell whether it's the same account. "
            "Everyday won't sync until you choose its bank account again.\n\n"
            "If SimpleFIN goes back to listing it as before, Everyday resumes syncing by itself.",
        ),
        (
            "owner1@example.com",
            "Reconnect SimpleFIN to resume syncing",
            "SimpleFIN rejected your connection.\n\nReconnect it in Settings with a new setup token before linking accounts to it.",
        ),
    ]


async def test_read_actions_needed_reads_nothing_of_another_users_accounts(connections):
    """The second owner asks about the first owner's accounts, which need a reconnect, and learns nothing"""
    connection = connections[0]
    ids = await _commit_links(connection, everyday={})
    await _reject(connection)

    assert await _read_as_owner(connections[1], ids.values()) == {}
