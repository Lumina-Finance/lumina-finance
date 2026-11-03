"""Pre-identity user lookup"""

import uuid
from typing import NamedTuple

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.rls.functions import FIND_LOGIN_ACCOUNT, FIND_LOGIN_USER


class LoginAccount(NamedTuple):
    """An account's id and its address as stored. Its mail goes only to that address"""

    id: uuid.UUID
    email: str


def fold_email(email: str) -> str:
    """Return the address with A to Z lower-cased and every other character kept

    Matches lower(email COLLATE "C") in the unique index and the lookups. str.lower would not, since it
    also folds letters such as İ and É. A spelling could then get a lockout count of its own or match
    an address the database treats as another account

    Args:
        email: Address in any capitalisation

    Returns:
        The address in the form every comparison and count uses
    """
    return email.encode().lower().decode()


def normalize_typed_spelling(email: str) -> str:
    """Return the address spelled as a typed one is stored: trimmed, with the domain lower-cased

    EmailStr does this for typed addresses but also refuses internal domains such as corp.local, and an
    address a sign-on provider sends must never be refused for that. The local part keeps its capitals,
    which the lookups fold themselves

    Args:
        email: Address as a provider sent it

    Returns:
        The address in the spelling a typed one would have
    """
    trimmed = email.strip()
    local, at, domain = trimmed.rpartition("@")
    return f"{local}@{domain.lower()}" if at else trimmed


async def find_user_id_by_email(db: AsyncSession, email: str) -> uuid.UUID | None:
    """Return the id of the user with the given email, or None

    Args:
        db: Active database session
        email: Email address to look up

    Returns:
        The matching user id when one exists
    """
    # Login and signup run before a request identity exists, so the lookup goes through
    # the SECURITY DEFINER helper that bypasses the self-only users policy, returning
    # only the id so nothing else about the user can leak through it
    return await db.scalar(text(f"SELECT {FIND_LOGIN_USER}(:email)"), {"email": email})


async def find_login_account(db: AsyncSession, email: str) -> LoginAccount | None:
    """Return the id and stored address of the user with the given email, or None

    Args:
        db: Active database session
        email: Email address to look up

    Returns:
        The matching account when one exists
    """
    account_query = text(f"SELECT id, email FROM {FIND_LOGIN_ACCOUNT}(:email)")  # noqa: S608
    row = (await db.execute(account_query, {"email": email})).first()
    return LoginAccount(row.id, row.email) if row else None
