"""The conditions all of one person's import rules may hold together"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.import_rule import ImportRule
from app.schemas.import_rule import MAX_IMPORT_RULE_CONDITIONS, ImportRuleBudgetResponse
from app.services.import_rules.validation import build_field_error, raise_field_errors

BUDGET_DETAIL = (
    f"Your import rules can hold {MAX_IMPORT_RULE_CONDITIONS} conditions in all. Please remove a condition from this rule or another rule first"
)

# Where the refusal is shown: on the conditions, since a person removes one of them to make room
CONDITIONS_LOCATION = ("conditions",)


def count_stored_conditions(items: list[dict[str, Any]]) -> int:
    """Return how many conditions stored items hold: each condition once, those inside groups included"""
    return sum(len(item["conditions"]) if item["kind"] == "group" else 1 for item in items)


async def count_conditions_held(db: AsyncSession, user_id: uuid.UUID, *, except_rule_id: uuid.UUID | None = None) -> int:
    """Return how many conditions the user's rules hold in all

    Args:
        db: Active database session
        user_id: Owner of the rules
        except_rule_id: A rule left out of the count, such as the one whose conditions are being replaced

    Returns:
        The conditions held by every rule of the user but the one left out
    """
    statement = select(ImportRule.conditions).where(ImportRule.owner_id == user_id)
    if except_rule_id is not None:
        statement = statement.where(ImportRule.id != except_rule_id)
    return sum(count_stored_conditions(items) for items in await db.scalars(statement))


async def refuse_over_budget(db: AsyncSession, user_id: uuid.UUID, new_conditions: int, *, except_rule_id: uuid.UUID | None = None) -> None:
    """Refuse conditions that would take the user's rules past the budget

    Called under `lock_user_rules`, so two requests that each fit alone can't both pass

    Args:
        db: Active database session
        user_id: Owner of the rules
        new_conditions: Conditions the request leaves its rule holding
        except_rule_id: The rule being edited, whose saved conditions the request replaces

    Raises:
        RequestValidationError: Raised with 422 as a field error on the conditions
    """
    held = await count_conditions_held(db, user_id, except_rule_id=except_rule_id)
    if held + new_conditions > MAX_IMPORT_RULE_CONDITIONS:
        raise_field_errors([build_field_error(CONDITIONS_LOCATION, BUDGET_DETAIL)])


async def get_import_rule_budget(db: AsyncSession, user_id: uuid.UUID) -> ImportRuleBudgetResponse:
    """Return the budget and how much of it the user's rules use

    Args:
        db: Active database session
        user_id: Authenticated user

    Returns:
        The limit and the conditions held now
    """
    return ImportRuleBudgetResponse(limit=MAX_IMPORT_RULE_CONDITIONS, used=await count_conditions_held(db, user_id))
