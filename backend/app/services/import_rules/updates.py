"""Editing an import rule"""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRuleTag
from app.models.user import User
from app.schemas.import_rule import ImportRuleResponse, UpdateImportRuleRequest, count_import_rule_conditions
from app.services.import_rules.budget import refuse_over_budget
from app.services.import_rules.changes import committing_rule_changes, get_rule_or_404, lock_user_rules, refuse_name_in_use
from app.services.import_rules.responses import build_import_rule_responses
from app.services.import_rules.validation import (
    ACTIONS_LOCATION,
    NO_ACTION_DETAIL,
    build_field_error,
    check_actions,
    prepare_conditions,
    raise_field_errors,
)


async def update_import_rule(db: AsyncSession, user: User, rule_id: uuid.UUID, data: UpdateImportRuleRequest) -> ImportRuleResponse:
    """Change the fields of a rule that the request carries

    Only what the request names is checked again, so a rule whose account has since been deleted can
    still be renamed. Sending the conditions again checks that account too

    Args:
        db: Active database session
        user: Authenticated user editing the rule
        rule_id: Rule from the route path
        data: The fields to change

    Returns:
        The rule as it now stands

    Raises:
        HTTPException: Raised with 404 for a rule that is absent or another user's, and 409 when the
            name is taken
        RequestValidationError: Raised with 422 naming each field that cannot be used, the rule's
            actions when the change would leave it setting nothing, or the conditions when they would
            take the user's rules past the budget
    """
    rule = await get_rule_or_404(db, rule_id, user.id)
    sent = data.model_fields_set

    errors = []
    conditions = rule.conditions
    if "conditions" in sent:
        conditions, errors = await prepare_conditions(db, user.id, data.conditions)
    errors += await check_actions(
        db,
        user.id,
        data.merchant_id if "merchant_id" in sent else None,
        data.category_id if "category_id" in sent else None,
        data.tag_ids if "tag_ids" in sent else [],
    )

    existing_tag_ids = set(await db.scalars(select(ImportRuleTag.tag_id).where(ImportRuleTag.import_rule_id == rule.id)))
    merchant_id = data.merchant_id if "merchant_id" in sent else rule.merchant_id
    category_id = data.category_id if "category_id" in sent else rule.category_id
    tag_ids = set(data.tag_ids) if "tag_ids" in sent else existing_tag_ids
    if merchant_id is None and category_id is None and not tag_ids:
        errors.append(build_field_error(ACTIONS_LOCATION, NO_ACTION_DETAIL))
    raise_field_errors(errors)

    if "conditions" in sent:
        # Taken before the others' conditions are counted, so a second request waits and then counts what the first committed
        await lock_user_rules(db, user.id)
        await refuse_over_budget(db, user.id, count_import_rule_conditions(data.conditions), except_rule_id=rule.id)

    if "name" in sent:
        await refuse_name_in_use(db, user.id, data.name, except_rule_id=rule.id)

    async with committing_rule_changes(db, user.id):
        if "name" in sent:
            rule.name = data.name
        if "match" in sent:
            rule.match = data.match
        rule.conditions = conditions
        rule.merchant_id = merchant_id
        rule.category_id = category_id
        rule.updated_at = func.now()

        # Only the tags that differ are written, so a tag kept is never deleted and added in one flush
        await db.execute(
            delete(ImportRuleTag).where(ImportRuleTag.import_rule_id == rule.id, ImportRuleTag.tag_id.in_(existing_tag_ids - tag_ids))
        )
        db.add_all(ImportRuleTag(import_rule_id=rule.id, tag_id=tag_id) for tag_id in tag_ids - existing_tag_ids)

    await db.refresh(rule)
    [response] = await build_import_rule_responses(db, user.id, [rule])
    return response
