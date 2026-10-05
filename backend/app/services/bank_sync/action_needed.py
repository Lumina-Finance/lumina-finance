"""Flagging what only the user can fix for a bank connection to sync, and emailing them once as each starts

Reconnect needed: the provider rejected the connection's credential, so none of its automatic sync
runs until the user reconnects it with a new one, which clears the mark

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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.bank_connection import BankAccountLink, BankConnection, BankLinkState
from app.models.user import User
from app.services.bank_sync.availability import PROVIDER_ADAPTERS
from app.services.email import RenderedEmail, get_email_sender, render_action_needed_email

logger = logging.getLogger(__name__)

# The Reconnect needed email, which leaves the provider's own message to the last attempt's reason.
# A connection with no linked accounts gets the opening and closing without the list
_RECONNECT_SUBJECT = "Reconnect {provider} to resume syncing"
_RECONNECT_LEAD = "{provider} rejected your {connection}, so these accounts have stopped syncing:"
_RECONNECT_CLOSING = "Reconnect it in Settings with a new setup token to pick up where they left off."
_RECONNECT_LEAD_UNLINKED = "{provider} rejected your {connection}."
_RECONNECT_CLOSING_UNLINKED = "Reconnect it in Settings with a new setup token before linking accounts to it."


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
