"""Moving an import rule to another place in the order"""

import uuid

from fastapi.exceptions import RequestValidationError
from sqlalchemy import case, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRule
from app.models.user import User
from app.schemas.import_rule import ImportRuleResponse
from app.services.import_rules.changes import committing_rule_changes, get_rule_or_404, lock_user_rules
from app.services.import_rules.responses import build_import_rule_responses
from app.services.import_rules.validation import build_field_error


async def move_import_rule(db: AsyncSession, user: User, rule_id: uuid.UUID, position: int) -> ImportRuleResponse:
    """Put a rule at a place in the order, shifting the rules between its old and new place by one

    Requests that add, remove or move rules take turns, so the positions are read after the one
    before has committed

    Args:
        db: Active database session
        user: Authenticated user
        rule_id: Rule from the route path
        position: The place the rule takes, counted from zero

    Returns:
        The moved rule, with the place it now has

    Raises:
        HTTPException: Raised with 404 for a rule that is absent or another user's
        RequestValidationError: Raised with 422 naming the position when it is past the last rule
    """
    await lock_user_rules(db, user.id)
    rule = await get_rule_or_404(db, rule_id, user.id)

    rule_count = await db.scalar(select(func.count()).select_from(ImportRule).where(ImportRule.owner_id == user.id))
    if position >= rule_count:
        raise RequestValidationError([build_field_error(("position",), "Position is past the last rule")])

    old_position = rule.position
    # A move to the place the rule already has still commits, so every answered write marks the user's data changed the same way
    async with committing_rule_changes(db, user.id):
        if position != old_position:
            # Every rule from the old place to the new one moves in one statement, the moved rule to its
            # new place and the others by one toward the gap it leaves, and the deferred position check
            # allows that. Naming the edit time keeps the column's own update from stamping rules that
            # only changed place
            step = 1 if position < old_position else -1
            await db.execute(
                update(ImportRule)
                .where(ImportRule.owner_id == user.id, ImportRule.position.between(min(position, old_position), max(position, old_position)))
                .values(position=case((ImportRule.id == rule.id, position), else_=ImportRule.position + step), updated_at=ImportRule.updated_at)
                .execution_options(synchronize_session=False)
            )
    await db.refresh(rule)

    [response] = await build_import_rule_responses(db, user.id, [rule])
    return response
