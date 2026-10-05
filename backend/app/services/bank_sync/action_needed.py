"""Flagging what only the user can fix for a bank connection to sync, and emailing them once as each starts

Reconnect needed: the provider rejected the connection's credential, so none of its automatic sync
runs until the user reconnects it with a new one, which clears the mark

Bank sign-in needed: the provider says a bank login behind the connection needs the user to sign in
again on the provider's site. Each of that login's accounts is marked as an attempt fails for it,
while the connection's other accounts keep syncing, and stays on the connection's daily sync rather
than retrying, so the mark clears once an attempt brings the account back whole. The state starts
for a login when the first of its active links is marked, and a notice per login records when, with
its email as sent, until none of them is marked

Each state is recorded with its email as sent, in the save that records the state, and the email
goes out only once that save has committed, so a job run again or cut off after the save sends
nothing twice, and one cut off before it sends nothing. A send that fails is logged and never undoes
the save or fails the sync. An email names the connection and the accounts affected, and carries
no credential, server or transaction data
"""

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import and_, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankExternalAccount, BankLinkState, BankSigninNotice
from app.models.user import User
from app.services.bank_sync.availability import PROVIDER_ADAPTERS
from app.services.email import RenderedEmail, get_email_sender, render_action_needed_email

logger = logging.getLogger(__name__)

# A link's bank account as the connection's provider last listed it
_LISTING_OF_LINK = and_(
    BankExternalAccount.connection_id == BankAccountLink.connection_id,
    BankExternalAccount.external_id == BankAccountLink.external_account_id,
)

# The Reconnect needed email, which leaves the provider's own message to the last attempt's reason.
# A connection with no linked accounts gets the opening and closing without the list
_RECONNECT_SUBJECT = "Reconnect {provider} to resume syncing"
_RECONNECT_LEAD = "{provider} rejected your {connection}, so syncing has stopped for:"
_RECONNECT_CLOSING = "Reconnect it in Settings with a new setup token to pick up where it left off."
_RECONNECT_LEAD_UNLINKED = "{provider} rejected your {connection}."
_RECONNECT_CLOSING_UNLINKED = "Reconnect it in Settings with a new setup token before linking accounts to it."

# The Bank sign-in needed email, one per bank login, naming that login's accounts. The subject
# leaves out the institution's name, which comes from the provider
_SIGNIN_SUBJECT = "Sign in to your bank again in {site}"
_SIGNIN_LEAD = "Sign in to {institution} again in {site}. Until you do, syncing has stopped for:"
_SIGNIN_CLOSING = "Lumina Finance checks daily and picks up where it left off once you have."


@dataclass(frozen=True)
class ActionEmail:
    """An action-needed email a save recorded as sent, to send once that save has committed"""

    recipient: str
    message: RenderedEmail

    # Named when the send fails, since the recipient's address isn't logged
    connection_id: uuid.UUID


async def flag_rejected_credential(db: AsyncSession, connection: BankConnection, *, at: datetime, now: datetime) -> list[ActionEmail]:
    """Mark a connection Reconnect needed as the provider rejects its credential, with its email recorded as sent

    The caller has locked the connection and checked that it still holds the credential the
    rejected request went out with, so a rejection of a credential a reconnect replaced marks
    nothing. A connection already marked keeps its mark and sends nothing more

    Args:
        db: The owner's session, which the caller commits
        connection: The connection, as locked
        at: When the request the provider rejected was sent, which the mark starts at
        now: When the save records it

    Returns:
        The email to send once the save commits, or nothing for a connection already marked
    """
    if connection.credential_rejected_at is not None:
        return []
    connection.credential_rejected_at = at
    connection.rejection_emailed_at = now

    accounts = (
        await db.scalars(
            select(Account.name)
            .join(BankAccountLink, BankAccountLink.account_id == Account.id)
            .where(BankAccountLink.connection_id == connection.id, BankAccountLink.state != BankLinkState.UNLINKED)
            .order_by(Account.name)
        )
    ).all()
    provider = PROVIDER_ADAPTERS[connection.provider].provider_name
    named = {"provider": provider, "connection": f"{connection.nickname} connection" if connection.nickname else "connection"}
    lead, closing = (_RECONNECT_LEAD, _RECONNECT_CLOSING) if accounts else (_RECONNECT_LEAD_UNLINKED, _RECONNECT_CLOSING_UNLINKED)
    message = render_action_needed_email(_RECONNECT_SUBJECT.format(**named), lead.format(**named), accounts, closing)
    return [ActionEmail(await _owner_email(db, connection), message, connection.id)]


async def flag_signin_needed(
    db: AsyncSession,
    connection: BankConnection,
    links: Sequence[BankAccountLink],
    *,
    at: datetime,
    now: datetime,
) -> list[ActionEmail]:
    """Mark links Bank sign-in needed as an attempt finds their bank login needs a sign-in, emailing once per login it starts for

    A link already marked keeps when its mark started. A login's state starts when none of its
    active links was marked before, and its notice then records the start with its email as sent,
    replacing one left behind by accounts since unlinked or chosen again

    Args:
        db: The owner's session, which the caller commits, with the connection and the links
            locked, and the bank transactions and pending items it stores already written
        connection: The connection, as locked
        links: The links the attempt failed for with a bank sign-in problem, as locked
        at: When the attempt's request was sent, which the marks start at
        now: When the save records them

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
                .join(BankAccountLink, _LISTING_OF_LINK)
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

    # Every linked bank account keeps its listing, which records the login it sits under
    rows = await db.execute(
        select(BankExternalAccount.login_key, BankExternalAccount.institution_name, Account.name)
        .join(BankAccountLink, _LISTING_OF_LINK)
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

    notices = insert(BankSigninNotice).values(
        [
            {"owner_id": connection.owner_id, "connection_id": connection.id, "login_key": login, "since": at, "emailed_at": now}
            for login in started
        ]
    )
    await db.execute(
        notices.on_conflict_do_update(
            index_elements=[BankSigninNotice.connection_id, BankSigninNotice.login_key],
            set_={"since": notices.excluded.since, "emailed_at": notices.excluded.emailed_at},
        )
    )
    site = PROVIDER_ADAPTERS[connection.provider].provider_site
    recipient = await _owner_email(db, connection)
    return [
        ActionEmail(
            recipient,
            render_action_needed_email(
                _SIGNIN_SUBJECT.format(site=site), _SIGNIN_LEAD.format(institution=institution, site=site), accounts, _SIGNIN_CLOSING
            ),
            connection.id,
        )
        for institution, accounts in started.values()
    ]


async def clear_signin_needed(db: AsyncSession, connection: BankConnection, links: Sequence[BankAccountLink]) -> None:
    """Clear Bank sign-in needed from links an attempt brought back whole, ending each login's state once none of its active links is marked

    Args:
        db: The owner's session, which the caller commits, with the connection and the links
            locked, and the bank transactions and pending items it stores already written
        connection: The connection, as locked
        links: The links the attempt succeeded for, as locked
    """
    clearing = [link for link in links if link.signin_needed_since is not None]
    if not clearing:
        return
    for link in clearing:
        link.signin_needed_since = None
    still_marked = (
        select(BankAccountLink.id)
        .join(BankExternalAccount, _LISTING_OF_LINK)
        .where(
            BankAccountLink.connection_id == connection.id,
            BankAccountLink.state == BankLinkState.ACTIVE,
            BankAccountLink.signin_needed_since.is_not(None),
            BankExternalAccount.login_key == BankSigninNotice.login_key,
        )
        .correlate(BankSigninNotice)
    )
    await db.flush()
    await db.execute(delete(BankSigninNotice).where(BankSigninNotice.connection_id == connection.id, ~still_marked.exists()))


async def send_action_emails(emails: Sequence[ActionEmail]) -> None:
    """Send action-needed emails whose saves have committed, through the configured sender

    Each is sent at most once: one that fails is logged and not tried again, since its state is
    already recorded as emailed and shows in the app either way
    """
    for email in emails:
        # A failed send must never fail the sync whose state it reports
        try:
            await get_email_sender().send(email.recipient, email.message)
        except Exception:
            logger.warning("Couldn't send an action-needed email about bank connection %s", email.connection_id, exc_info=True)


async def _owner_email(db: AsyncSession, connection: BankConnection) -> str:
    """Return the email address of the connection's owner"""
    return await db.scalar(select(User.email).where(User.id == connection.owner_id))
