"""Deleting an import rule"""

import uuid

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRule
from app.models.user import User
from app.services.import_rules.changes import committing_rule_changes, get_rule_or_404, lock_user_rules


async def delete_import_rule(db: AsyncSession, user: User, rule_id: uuid.UUID) -> None:
    """Delete one of the user's rules and close the gap it leaves in the order

    Args:
        db: Active database session
        user: Authenticated user deleting the rule
        rule_id: Rule from the route path

    Raises:
        HTTPException: Raised with 404 for a rule that is absent or another user's
    """
    # Taken before the rule is read, so a request moving rules at the same moment is waited for
    await lock_user_rules(db, user.id)
    rule = await get_rule_or_404(db, rule_id, user.id)
    deleted_position = rule.position

    async with committing_rule_changes(db, user.id):
        await db.delete(rule)

        # The rules after it each move up one in a single statement, and the deferred position
        # check allows that. Naming the edit time keeps the column's own update from stamping rules
        # that only changed place
        await db.execute(
            update(ImportRule)
            .where(ImportRule.owner_id == user.id, ImportRule.position > deleted_position)
            .values(position=ImportRule.position - 1, updated_at=ImportRule.updated_at)
            .execution_options(synchronize_session=False)
        )
