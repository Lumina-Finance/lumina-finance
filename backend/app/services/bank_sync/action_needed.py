"""Flagging what only the user can fix for a bank connection to sync, emailing them once as each starts, and reading it back

Reconnect needed: the provider rejected the connection's credential, so none of its automatic sync
runs until the user reconnects it with a new one. That clears the mark

Bank sign-in needed: the provider says a bank login behind the connection needs the user to sign in
again on the provider's site. Each of that login's accounts is marked as an attempt fails for it,
while the connection's other accounts keep syncing, and stays on the connection's daily sync rather
than retrying, so the mark clears once an attempt brings the account back whole, or once a listing
moves its link to Choose bank account, since no sync would clear it there. The state starts for a login,
and emails the owner, when the first of its active links is marked

Choose bank account: a sync's listing found a linked bank account gone or in another currency, so its
account stops syncing until the user chooses its bank account again or the provider lists it as
before. Moving the link records the state, so a job run again finds it moved and emails nothing. A
reconnect's listing moves links while the user is in the app choosing, so it emails nothing

The save that records a state starting is what records its email as due, and the email goes out
right after that save commits, so a job run again or cut off after the save finds the state
already started and sends nothing twice, and one cut off before it sends nothing. A send that
fails is logged and never undoes the save or fails the sync. Sends run within the job's time
limit, and one the limit cuts off is logged as unsent by its state and the connection, bank login
or link it is about. An email names what stopped syncing and what to do, and carries no
credential, server or transaction data

Reconnect needed and Bank sign-in needed are read back per account, with when each began, for the
account's sync status. Choose bank account shows as the link's own state
"""

import enum
import logging
import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState
from app.models.user import User
from app.services.bank_sync.availability import LINK_LISTING, LIVE_LINK, provider_label, provider_site_label
from app.services.email import RenderedEmail, get_email_sender, render_action_needed_email

logger = logging.getLogger(__name__)

# The Reconnect needed email leaves the provider's own message to the last attempt's reason.
# A connection with no linked accounts gets the opening and closing without the list
_RECONNECT_SUBJECT = "Reconnect {provider} to resume syncing"
_RECONNECT_LEAD = "{provider} rejected your {connection}, so syncing has stopped for:"
_RECONNECT_CLOSING = "Reconnect it in Settings to pick up where it left off."
_RECONNECT_LEAD_UNLINKED = "{provider} rejected your {connection}."
_RECONNECT_CLOSING_UNLINKED = "Reconnect it in Settings before linking accounts to it."

# The Bank sign-in needed email, one per bank login, naming that login's accounts. The subject
# leaves out the institution's name, since it comes from the provider
_SIGNIN_SUBJECT = "Sign in to your bank again in {site}"
_SIGNIN_LEAD = "Sign in to {institution} again in {site}. Until you do, syncing has stopped for:"
_SIGNIN_CLOSING = "Lumina Finance checks daily and picks up where it left off once you have."

# The Choose bank account email, one per account a sync's listing moved there, worded as the
# settings section explains it. The subject leaves out the names, since they come from the user and the provider
_CHOOSE_SUBJECT = "Choose a bank account again to resume syncing"
_CHOOSE_LEAD = (
    "{provider} now lists {bank_account} differently, so Lumina Finance can't tell whether it's the same account. "
    "{account} won't sync until you choose its bank account again."
)
_CHOOSE_CLOSING = "If {provider} goes back to listing it as before, {account} resumes syncing by itself."


@dataclass(frozen=True)
class ActionEmail:
    """An action-needed email for a state a save started, to send once that save has committed"""

    recipient: str
    message: RenderedEmail

    # What a log line names in place of the recipient and every name when the email isn't sent: the
    # state, and the connection's id, with the bank login's key for Bank sign-in needed, or for
    # Choose bank account the link's id
    about: str


class ActionNeededKind(enum.StrEnum):
    """What the user has to do for an account's sync to resume"""

    # Reconnect the account's connection in Settings with a new credential
    RECONNECT = "reconnect"

    # Sign in to the account's bank again on the provider's site
    BANK_LOGIN = "bank_login"


@dataclass(frozen=True)
class ActionNeeded:
    """What the user has to do for an account's sync to resume, and when that began"""

    kind: ActionNeededKind
    since: datetime


async def read_actions_needed(db: AsyncSession, account_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, ActionNeeded]:
    """Return what the user has to do for each account's sync to resume, for the accounts that need something

    Every account still linked through a connection whose credential was rejected needs a
    reconnect, from when the credential was rejected. That comes before any bank sign-in, since
    reconnecting comes first. Otherwise a link marked as waiting on a bank sign-in needs one, from
    when it was marked. An account no longer linked needs nothing

    Args:
        db: The owner's session
        account_ids: The accounts to read

    Returns:
        What each account that needs something needs, by account id
    """
    links = await db.execute(
        select(BankAccountLink.account_id, BankAccountLink.signin_needed_since, BankConnection.credential_rejected_at)
        .join(BankConnection, BankConnection.id == BankAccountLink.connection_id)
        .where(BankAccountLink.account_id.in_(account_ids), LIVE_LINK)
    )
    needed = {}
    for account_id, signin_needed_since, credential_rejected_at in links:
        if credential_rejected_at is not None:
            needed[account_id] = ActionNeeded(ActionNeededKind.RECONNECT, credential_rejected_at)
        elif signin_needed_since is not None:
            needed[account_id] = ActionNeeded(ActionNeededKind.BANK_LOGIN, signin_needed_since)
    return needed


async def flag_rejected_credential(db: AsyncSession, connection: BankConnection, *, at: datetime) -> list[ActionEmail]:
    """Mark a connection Reconnect needed as the provider rejects its credential, returning the email to send its owner

    The caller has locked the connection and checked that it still holds the credential the
    rejected request went out with, so a rejection of a credential a reconnect replaced marks
    nothing. Only a job marks a connection, and a job claimed for a connection already marked ends
    without a request, so the connection here is never marked yet

    Args:
        db: The owner's session, committed by the caller
        connection: The connection, as locked
        at: When the request the provider rejected was sent. The mark starts at that time

    Returns:
        The email to send once the save commits
    """
    connection.credential_rejected_at = at

    accounts = (
        await db.scalars(
            select(Account.name)
            .join(BankAccountLink, BankAccountLink.account_id == Account.id)
            .where(BankAccountLink.connection_id == connection.id, BankAccountLink.state != BankLinkState.UNLINKED)
            .order_by(Account.name)
        )
    ).all()
    provider = provider_label(connection.provider, connection.provider_name)
    named = {"provider": provider, "connection": f"{connection.nickname} connection" if connection.nickname else "connection"}
    lead, closing = (_RECONNECT_LEAD, _RECONNECT_CLOSING) if accounts else (_RECONNECT_LEAD_UNLINKED, _RECONNECT_CLOSING_UNLINKED)
    message = render_action_needed_email(_RECONNECT_SUBJECT.format(**named), lead.format(**named), accounts, closing)
    return [ActionEmail(await _owner_email(db, connection), message, f"Reconnect needed on connection {connection.id}")]


async def flag_signin_needed(
    db: AsyncSession,
    connection: BankConnection,
    links: Sequence[BankAccountLink],
    *,
    at: datetime,
) -> list[ActionEmail]:
    """Mark links Bank sign-in needed as an attempt finds their bank login needs a sign-in, emailing once per login it starts for

    A link already marked keeps when its mark started. A login's state starts when none of its
    active links was marked before, so the mark an unlinked account was left with doesn't keep it going

    Args:
        db: The owner's session, committed by the caller, with the connection and the links locked
        connection: The connection, as locked
        links: The links the attempt failed for with a bank sign-in problem, as locked
        at: When the attempt's request was sent. The marks start at that time

    Returns:
        The emails to send once the save commits, one for each login whose state started
    """
    marking = [link for link in links if link.signin_needed_since is None]
    if not marking:
        return []
    marked_before = set(
        (
            await db.scalars(
                select(BankExternalAccount.login_key)
                .join(BankAccountLink, LINK_LISTING)
                .where(
                    BankAccountLink.connection_id == connection.id,
                    BankAccountLink.state == BankLinkState.ACTIVE,
                    BankAccountLink.signin_needed_since.is_not(None),
                )
            )
        ).all()
    )
    for link in marking:
        link.signin_needed_since = at

    # Every linked bank account keeps its listing, and the listing records the login it sits under
    rows = await db.execute(
        select(BankExternalAccount.login_key, BankExternalAccount.institution_name, Account.name)
        .join(BankAccountLink, LINK_LISTING)
        .join(Account, Account.id == BankAccountLink.account_id)
        .where(BankAccountLink.id.in_([link.id for link in marking]))
        .order_by(BankExternalAccount.login_key, Account.name)
    )
    started: dict[str, tuple[str, list[str]]] = {}
    for login, institution, account in rows:
        if login not in marked_before:
            started.setdefault(login, (institution, []))[1].append(account)
    if not started:
        return []

    site = provider_site_label(connection.provider)
    recipient = await _owner_email(db, connection)
    return [
        ActionEmail(
            recipient,
            render_action_needed_email(
                _SIGNIN_SUBJECT.format(site=site), _SIGNIN_LEAD.format(institution=institution, site=site), accounts, _SIGNIN_CLOSING
            ),
            f"Bank sign-in needed for bank login {login} on connection {connection.id}",
        )
        for login, (institution, accounts) in started.items()
    ]


def clear_signin_needed(links: Sequence[BankAccountLink]) -> None:
    """Clear Bank sign-in needed from links a response brought back whole, a login's state ending once none of its active links is marked

    A response that re-reads only days a link already has brings it back whole without the attempt
    counting as a success, and still shows its bank login answering

    Args:
        links: The links the response brought back whole, as the caller locked them
    """
    for link in links:
        link.signin_needed_since = None


async def choose_account_emails(db: AsyncSession, connection: BankConnection, links: Sequence[BankAccountLink]) -> list[ActionEmail]:
    """Return the emails telling the owner of each link a sync's listing just moved to Choose bank account

    Args:
        db: The owner's session, in which the listing moved the links
        connection: The connection listed
        links: The links the listing moved from active to Choose bank account

    Returns:
        One email per link, to send once the save moving them commits
    """
    if not links:
        return []
    accounts = await db.execute(select(Account.id, Account.name).where(Account.id.in_([link.account_id for link in links])))
    names = {account_id: name for account_id, name in accounts}
    provider = provider_label(connection.provider, connection.provider_name)
    recipient = await _owner_email(db, connection)
    emails = []
    for link in links:
        named = {"provider": provider, "bank_account": link.external_account_name, "account": names[link.account_id]}
        message = render_action_needed_email(_CHOOSE_SUBJECT, _CHOOSE_LEAD.format(**named), [], _CHOOSE_CLOSING.format(**named))
        emails.append(ActionEmail(recipient, message, f"Choose bank account on link {link.id}"))
    return emails


async def send_action_emails(outbox: list[ActionEmail]) -> None:
    """Send the action-needed emails waiting in an outbox through the configured sender, once their saves have committed

    Each is taken out once tried, so it is sent at most once: one that fails is logged and not tried
    again, since its state has already started and shows in the app either way. The caller's time
    limit bounds the sends, and when it cancels them, the email being sent and every one after it
    stay in the outbox, for the caller to log as unsent

    Args:
        outbox: The emails to send, in order, emptied as they are sent

    Raises:
        CancelledError: The caller was cancelled while sending
    """
    while outbox:
        email = outbox[0]
        try:
            await get_email_sender().send(email.recipient, email.message)
        except Exception as error:
            # A failed send must never fail the sync whose state it reports. A mail server's error
            # often repeats the recipient, so only the error's type is logged
            logger.warning("Couldn't send the action-needed email for %s: %s", email.about, type(error).__name__)
        del outbox[0]


def log_unsent_action_emails(emails: Sequence[ActionEmail]) -> None:
    """Log each action-needed email a stopped job leaves unsent, by its state and what it is about, naming no one"""
    for email in emails:
        logger.warning("The action-needed email for %s was left unsent, as its job was stopped", email.about)


async def _owner_email(db: AsyncSession, connection: BankConnection) -> str:
    """Return the email address of the connection's owner"""
    return await db.scalar(select(User.email).where(User.id == connection.owner_id))
