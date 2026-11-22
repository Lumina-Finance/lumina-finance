"""Shared import rule route test helpers: conditions, rules and the records a rule names"""

import uuid

from sqlalchemy import delete

from app.models.import_rule import ImportRule
from app.schemas.import_rule import MAX_IMPORT_RULE_CONDITIONS
from tests.conftest import TestSession

# What a change past the budget is refused with
BUDGET_REFUSAL = (
    f"Your import rules can hold {MAX_IMPORT_RULE_CONDITIONS} conditions in all. Please remove a condition from this rule or another rule first"
)


def _description_contains(value: str) -> dict:
    """Return a condition on the bank's description containing some text"""
    return {"kind": "condition", "attribute": "description", "operator": "contains", "value": value}


def _amount_at_least(amount: str, currency: str = "CAD") -> dict:
    """Return a condition on the size of the amount being at least a figure, typed as decimal text"""
    return {"kind": "condition", "attribute": "amount", "operator": "at_least", "value": amount, "currency": currency}


def _direction_is(value: str) -> dict:
    """Return a condition on money coming in or going out"""
    return {"kind": "condition", "attribute": "direction", "operator": "is", "value": value}


def _account_is(account_id: str, operator: str = "is") -> dict:
    """Return a condition on the account"""
    return {"kind": "condition", "attribute": "account", "operator": operator, "value": account_id}


def _group_of(match: str, *conditions: dict) -> dict:
    """Return a group of conditions"""
    return {"kind": "group", "match": match, "conditions": list(conditions)}


async def _create_rule(client, headers, **overrides):
    """Create a rule via POST /import-rules

    Defaults: name="Market", match="all", and one condition on the description containing "market".
    A rule needs an action, so a caller passes merchant_id, category_id or tag_ids

    Args:
        client: The async test client
        headers: Auth headers for the requesting user
        **overrides: Fields to override in the default payload

    Returns:
        The HTTP response from the API
    """
    payload = {"name": "Market", "match": "all", "conditions": [_description_contains("market")], **overrides}
    return await client.post("/import-rules", json=payload, headers=headers)


async def _create_rule_ok(client, headers, **overrides) -> dict:
    """Create a rule that is expected to be accepted, and return it"""
    response = await _create_rule(client, headers, **overrides)
    assert response.status_code == 201, response.text
    return response.json()


async def _make_merchant(client, headers, name: str = "Market", **overrides) -> str:
    """Create a merchant that is expected to be accepted, and return its id"""
    response = await client.post("/merchants", json={"name": name, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _make_category(client, headers, name: str = "Snacks", kind: str = "expense", **overrides) -> str:
    """Create a category that is expected to be accepted, and return its id"""
    response = await client.post("/categories", json={"name": name, "kind": kind, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _make_tag(client, headers, name: str = "Review", **overrides) -> str:
    """Create a tag that is expected to be accepted, and return its id"""
    response = await client.post("/tags", json={"name": name, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _system_category_id(client, headers, name: str) -> str:
    """Return the id of a category that ships with the app"""
    response = await client.get("/categories", headers=headers)
    return next(category["id"] for category in response.json() if category["name"] == name and category["is_system"])


def _field_errors(response) -> list[tuple[tuple, str]]:
    """Return the fields a 422 names, as (location without the body, message)"""
    assert response.status_code == 422, response.text
    return [(tuple(error["loc"][1:]), error["msg"]) for error in response.json()["detail"]]


def _delete_rule_and_record_after_rules_load(monkeypatch, module, rule_id: str, model, record_id: str) -> None:
    """Delete a rule and the merchant or category it names from another session once a request has read the rules, as a second request could

    Args:
        monkeypatch: The test's monkeypatch
        module: The module whose `load_import_rules` the request reads the rules with
        rule_id: The rule to delete first, since it holds the record
        model: The model of the record, Merchant or Category
        record_id: The record to delete
    """
    load = module.load_import_rules

    async def load_then_delete(*args, **kwargs):
        loaded = await load(*args, **kwargs)
        async with TestSession() as session:
            await session.execute(delete(ImportRule).where(ImportRule.id == uuid.UUID(rule_id)))
            await session.execute(delete(model).where(model.id == uuid.UUID(record_id)))
            await session.commit()
        return loaded

    monkeypatch.setattr(module, "load_import_rules", load_then_delete)
