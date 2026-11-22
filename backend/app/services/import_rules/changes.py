"""What every write to the rules shares: finding a rule, taking turns and committing"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRule
from app.models.user import User
from app.services.cache_state import mark_cache_changed_for_scope

NOT_FOUND_DETAIL = "Import rule not found"
NAME_TAKEN_DETAIL = "An import rule with this name already exists"

# Answered when something a rule names changed under the request, such as a merchant deleted by another request
CHANGED_DETAIL = "Your import rules or the records they name changed meanwhile. Please try again."

# The name's unique index is enforced by the database at once, unlike the deferred position
_NAME_INDEX = "uq_import_rules_owner_name"

# What the database says when a row's policy refuses a write
_SECURITY_REFUSAL = "row-level security"


async def lock_user_rules(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Make a request that adds, removes or moves rules wait for the user's other such requests

    Two of them reading the same last position would each insert it, and the deferred position check
    would then fail the second at its commit. Holding the user's own row lets the second read what
    the first committed. The lock leaves the row's key alone, so the foreign key checks of the user's
    other writes don't wait on it, and rules differ per user, so this holds nobody else up

    Args:
        db: Active database session
        user_id: Owner of the rules. Their row is locked until the transaction ends
    """
    await db.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))


async def get_rule_or_404(db: AsyncSession, rule_id: uuid.UUID, user_id: uuid.UUID) -> ImportRule:
    """Return one of the user's rules

    Args:
        db: Active database session
        rule_id: Rule from the route path
        user_id: Authenticated user

    Returns:
        The rule

    Raises:
        HTTPException: Raised with 404 for a rule that is absent or another user's
    """
    rule = await db.scalar(select(ImportRule).where(ImportRule.id == rule_id, ImportRule.owner_id == user_id))
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=NOT_FOUND_DETAIL)
    return rule


async def refuse_name_in_use(db: AsyncSession, user_id: uuid.UUID, name: str, *, except_rule_id: uuid.UUID | None = None) -> None:
    """Refuse a name another of the user's rules already has, whatever its capitals

    Args:
        db: Active database session
        user_id: Authenticated user
        name: The name asked for, trimmed
        except_rule_id: The rule being renamed, which may keep its own name

    Raises:
        HTTPException: Raised with 409 when the name is taken
    """
    statement = select(ImportRule.id).where(ImportRule.owner_id == user_id, func.lower(ImportRule.name) == name.lower())
    if except_rule_id is not None:
        statement = statement.where(ImportRule.id != except_rule_id)
    if await db.scalar(statement) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=NAME_TAKEN_DETAIL)


@asynccontextmanager
async def committing_rule_changes(db: AsyncSession, user_id: uuid.UUID) -> AsyncIterator[None]:
    """Hold the writes of one request, then flush, mark the user's data changed and commit

    Any statement of the block can meet a clash, since each one flushes what came before it. A name
    taken at the same moment fails at a flush. A merchant, category or tag deleted at the same moment
    fails its row's security policy or its foreign key, and so would a position taken twice at the
    commit, which the lock on the user's rules keeps from happening. Each is answered with 409

    Args:
        db: Active database session
        user_id: Authenticated user

    Raises:
        HTTPException: Raised with 409 naming the name when it is taken, or that the rules changed
    """
    try:
        yield
        await db.flush()
        await mark_cache_changed_for_scope(db, user_id=user_id, group_id=None)
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        detail = NAME_TAKEN_DETAIL if _NAME_INDEX in str(error.orig) else CHANGED_DETAIL
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from error
    except ProgrammingError as error:
        # A rule naming a merchant, category or tag the user can no longer see is refused by row-level
        # security before the foreign key is reached. A deletion at the same moment shows up this way
        if _SECURITY_REFUSAL not in str(error.orig):
            raise
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=CHANGED_DETAIL) from error
