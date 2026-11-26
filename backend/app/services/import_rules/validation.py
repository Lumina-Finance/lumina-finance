"""Checking what a rule names against what its user may use

Every refusal is a request validation error with the path of the field it is about, built as the
schema's own are, so the screen finds the field the same way for both. That path carries the
union tags the schema's errors carry: a condition's is `("conditions", 2, "condition", "amount",
"value")` and one inside a group's is `("conditions", 2, "group", "conditions", 0, "amount", "value")`
"""

import uuid
from collections.abc import Iterator, Sequence
from typing import Any

from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.base import CategoryKind
from app.models.category import Category
from app.models.currency import Currency
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.schemas.import_rule import (
    AccountCondition,
    AmountConditionRequest,
    ImportRuleConditionRequest,
    ImportRuleGroupRequest,
    ImportRuleItemRequest,
)
from app.services.accounts.access import own_personal_account_condition
from app.services.importers.shared.merchants import get_import_merchant_scope_filter
from app.services.importers.shared.tags import get_import_tag_scope_filter
from app.utils.money import DecimalAmountParseError, DecimalAmountPrecisionError, parse_decimal_amount_to_minor_units

NO_ACTION_DETAIL = "Choose a merchant, a category or at least one tag"
TRANSFER_CATEGORY_DETAIL = "Choose a category that isn't a transfer"

# Where a refusal about the actions is shown, since the three actions are checked together
ACTIONS_LOCATION = ("actions",)

Location = tuple[str | int, ...]


def build_field_error(location: Sequence[str | int], message: str) -> dict[str, Any]:
    """Return one refusal in the shape a refused request body carries, so the screen finds its field

    Args:
        location: Path to the field within the body, such as ("name",)
        message: What is wrong with it

    Returns:
        The error entry
    """
    return {"type": "value_error", "loc": ("body", *location), "msg": message}


def raise_field_errors(errors: list[dict[str, Any]]) -> None:
    """Refuse the request with 422, every field named, when there are any errors

    Raises:
        RequestValidationError: Raised with the errors. The app answers it as it does any request
            body that fails its schema
    """
    if errors:
        raise RequestValidationError(errors)


def _walk_conditions(items: list[ImportRuleItemRequest]) -> Iterator[tuple[Location, ImportRuleConditionRequest]]:
    """Yield each condition with the path of its tags inside the body, groups' conditions included"""
    for index, item in enumerate(items):
        if isinstance(item, ImportRuleGroupRequest):
            for inner_index, condition in enumerate(item.conditions):
                yield ("conditions", index, "group", "conditions", inner_index, condition.attribute), condition
        else:
            yield ("conditions", index, item.kind, item.attribute), item


def _read_amount(condition: AmountConditionRequest, exponent: int) -> tuple[int | None, str | None]:
    """Read an amount's text at its currency's own precision, refusing one it can't hold

    Returns:
        The amount in minor units, or the reason it can't be used
    """
    try:
        minor_units = parse_decimal_amount_to_minor_units(condition.value, currency_code=condition.currency, minor_unit_exponent=exponent)
    except DecimalAmountPrecisionError:
        return None, f"Amount has too many decimal places for {condition.currency}"
    except DecimalAmountParseError:
        return None, "Amount must be a number the app can store"
    if minor_units <= 0:
        return None, "Amount must be greater than zero"
    return minor_units, None


async def prepare_conditions(
    db: AsyncSession,
    user_id: uuid.UUID,
    items: list[ImportRuleItemRequest],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Check what a rule's conditions name and put them in the form they are stored in

    Amounts are read in the precision of their currency, looked up once for the request, and kept as
    minor units. Accounts must be the user's own, never a group's

    Args:
        db: Active database session
        user_id: User writing the rule
        items: The rule's conditions and groups, as the request carried them

    Returns:
        The conditions as stored, and one error for each currency that does not exist, amount that
        can't be used and account that is not the user's own
    """
    located = list(_walk_conditions(items))
    currency_codes = {condition.currency for _, condition in located if isinstance(condition, AmountConditionRequest)}
    account_ids = {condition.value for _, condition in located if isinstance(condition, AccountCondition)}

    exponents: dict[str, int] = {}
    if currency_codes:
        rows = await db.execute(select(Currency.id, Currency.minor_unit_exponent).where(Currency.id.in_(currency_codes)))
        exponents = {code: exponent for code, exponent in rows}
    own_account_ids: set[uuid.UUID] = set()
    if account_ids:
        own_account_ids = set(await db.scalars(select(Account.id).where(Account.id.in_(account_ids), own_personal_account_condition(user_id))))

    errors: list[dict[str, Any]] = []
    amounts_in_minor_units: dict[int, int] = {}
    for location, condition in located:
        if isinstance(condition, AccountCondition) and condition.value not in own_account_ids:
            errors.append(build_field_error((*location, "value"), "Account not found"))
        if isinstance(condition, AmountConditionRequest):
            if condition.currency not in exponents:
                errors.append(build_field_error((*location, "currency"), "Currency not found"))
                continue
            minor_units, refusal = _read_amount(condition, exponents[condition.currency])
            if minor_units is None:
                errors.append(build_field_error((*location, "value"), refusal))
            else:
                amounts_in_minor_units[id(condition)] = minor_units

    def store(condition: ImportRuleConditionRequest) -> dict[str, Any]:
        stored = condition.model_dump(mode="json")
        if isinstance(condition, AmountConditionRequest):
            stored["value"] = amounts_in_minor_units.get(id(condition))
        return stored

    stored_items = [
        {**item.model_dump(mode="json"), "conditions": [store(condition) for condition in item.conditions]}
        if isinstance(item, ImportRuleGroupRequest)
        else store(item)
        for item in items
    ]
    return stored_items, errors


async def check_actions(
    db: AsyncSession,
    user_id: uuid.UUID,
    merchant_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
    tag_ids: Sequence[uuid.UUID],
) -> list[dict[str, Any]]:
    """Check the merchant, category and tags a rule sets

    A merchant or category may be the user's own or one the app ships with, and a tag must be the
    user's own, as file imports accept them today. Group ones are left out, since a rule belongs to
    one user. A rule never sets a transfer category, balance adjustment included, since a rule says
    nothing about the account on the other side of a transfer

    Args:
        db: Active database session
        user_id: User writing the rule
        merchant_id: Merchant the rule would set
        category_id: Category the rule would set
        tag_ids: Tags the rule would add

    Returns:
        One error for each that is not usable
    """
    errors = []
    if merchant_id is not None:
        found = await db.scalar(select(Merchant.id).where(Merchant.id == merchant_id, get_import_merchant_scope_filter(user_id)))
        if found is None:
            errors.append(build_field_error(("merchant_id",), "Merchant not found"))

    if category_id is not None:
        kind = await db.scalar(
            select(Category.kind).where(
                Category.id == category_id,
                Category.is_system.is_(True) | ((Category.owner_id == user_id) & Category.group_id.is_(None)),
            )
        )
        if kind is None:
            errors.append(build_field_error(("category_id",), "Category not found"))
        elif kind == CategoryKind.TRANSFER:
            errors.append(build_field_error(("category_id",), TRANSFER_CATEGORY_DETAIL))

    if tag_ids:
        own_tag_ids = set(await db.scalars(select(Tag.id).where(Tag.id.in_(tag_ids), get_import_tag_scope_filter(user_id))))
        errors.extend(
            build_field_error(("tag_ids", index), "Tag not found") for index, tag_id in enumerate(tag_ids) if tag_id not in own_tag_ids
        )
    return errors
