"""Creating an import rule"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.allowance_hook import AllowanceKind
from app.models.import_rule import ImportRule, ImportRuleTag
from app.models.user import User
from app.schemas.import_rule import CreateImportRuleRequest, ImportRuleResponse, count_import_rule_conditions
from app.services.allowance.require import require_allowance
from app.services.import_rules.budget import refuse_over_budget
from app.services.import_rules.changes import committing_rule_changes, lock_user_rules, refuse_name_in_use
from app.services.import_rules.responses import build_import_rule_responses
from app.services.import_rules.validation import (
    ACTIONS_LOCATION,
    NO_ACTION_DETAIL,
    build_field_error,
    check_actions,
    prepare_conditions,
    raise_field_errors,
)


async def create_import_rule(db: AsyncSession, user: User, data: CreateImportRuleRequest) -> ImportRuleResponse:
    """Add a rule at the bottom of the user's list

    Args:
        db: Active database session
        user: Authenticated user creating the rule
        data: The rule

    Returns:
        The created rule

    Raises:
        RequestValidationError: Raised with 422 naming each field that cannot be used, the rule's
            actions when it sets nothing, or the conditions when they take the user's rules past the budget
        HTTPException: Raised with 409 when the name is taken, or with 403 when the allowance check refuses one more rule
    """
    conditions, errors = await prepare_conditions(db, user.id, data.conditions)
    errors += await check_actions(db, user.id, data.merchant_id, data.category_id, data.tag_ids)
    if data.merchant_id is None and data.category_id is None and not data.tag_ids:
        errors.append(build_field_error(ACTIONS_LOCATION, NO_ACTION_DETAIL))
    raise_field_errors(errors)

    # Taken before the last position is read, so a second request waits and then reads the first's rule
    await lock_user_rules(db, user.id)
    await refuse_over_budget(db, user.id, count_import_rule_conditions(data.conditions))
    await refuse_name_in_use(db, user.id, data.name)
    await require_allowance(db, user.id, AllowanceKind.IMPORT_RULE)
    last_position = await db.scalar(select(func.max(ImportRule.position)).where(ImportRule.owner_id == user.id))
    rule = ImportRule(
        id=uuid.uuid4(),
        owner_id=user.id,
        name=data.name,
        position=0 if last_position is None else last_position + 1,
        match=data.match,
        conditions=conditions,
        merchant_id=data.merchant_id,
        category_id=data.category_id,
    )
    async with committing_rule_changes(db, user.id):
        db.add(rule)
        db.add_all(ImportRuleTag(import_rule_id=rule.id, tag_id=tag_id) for tag_id in data.tag_ids)

    await db.refresh(rule)
    [response] = await build_import_rule_responses(db, user.id, [rule])
    return response
