"""Import rule routes"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.import_rule import (
    CreateImportRuleRequest,
    ImportRuleBudgetResponse,
    ImportRuleResponse,
    MoveImportRuleRequest,
    UpdateImportRuleRequest,
)
from app.services.import_rules.budget import get_import_rule_budget
from app.services.import_rules.creation import create_import_rule
from app.services.import_rules.deletion import delete_import_rule
from app.services.import_rules.listing import list_import_rules
from app.services.import_rules.positions import move_import_rule
from app.services.import_rules.updates import update_import_rule
from app.utils.pagination import LIST_PAGE_SIZE, LIST_SEARCH_MAX_LENGTH, MAX_LIST_OFFSET

router = APIRouter(prefix="/import-rules", tags=["import-rules"])


@router.get("", response_model=list[ImportRuleResponse])
async def list_rules(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    q: Annotated[str | None, Query(max_length=LIST_SEARCH_MAX_LENGTH)] = None,
    limit: Annotated[int, Query(ge=1, le=LIST_PAGE_SIZE)] = LIST_PAGE_SIZE,
    offset: Annotated[int, Query(ge=0, le=MAX_LIST_OFFSET)] = 0,
):
    """Return a page of the user's import rules in the order they are checked

    Args:
        user: Authenticated user
        db: Active database session
        q: Optional text to find in a rule's name, in the text its Description and Note conditions look for,
            or in the name of the merchant, category or tag it sets
        limit: Maximum number of rules to return
        offset: Number of rules to skip before returning rules

    Returns:
        The rules, first checked first, each with the names its row shows
    """
    return await list_import_rules(db, user.id, limit, offset, q)


@router.get("/budget", response_model=ImportRuleBudgetResponse)
async def read_budget(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Return the conditions the user's rules may hold in all, and how many they hold now

    Args:
        user: Authenticated user
        db: Active database session

    Returns:
        The limit and the conditions in use
    """
    return await get_import_rule_budget(db, user.id)


@router.post("", response_model=ImportRuleResponse, status_code=status.HTTP_201_CREATED)
async def create_rule(
    data: CreateImportRuleRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Create a rule at the bottom of the list

    Args:
        data: The rule
        user: Authenticated user
        db: Active database session

    Returns:
        The created rule
    """
    return await create_import_rule(db, user, data)


@router.patch("/{rule_id}", response_model=ImportRuleResponse)
async def update_rule(
    rule_id: uuid.UUID,
    data: UpdateImportRuleRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Change a rule

    Args:
        rule_id: Rule identifier from the route path
        data: The fields to change
        user: Authenticated user
        db: Active database session

    Returns:
        The rule as it now stands
    """
    return await update_import_rule(db, user, rule_id, data)


@router.put("/{rule_id}/position", response_model=ImportRuleResponse)
async def move_rule(
    rule_id: uuid.UUID,
    data: MoveImportRuleRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Move a rule to another place in the order they are checked

    Args:
        rule_id: Rule identifier from the route path
        data: The place the rule takes, counted from zero
        user: Authenticated user
        db: Active database session

    Returns:
        The moved rule, with the place it now has
    """
    return await move_import_rule(db, user, rule_id, data.position)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(
    rule_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Delete a rule, closing the gap it leaves in the order

    Args:
        rule_id: Rule identifier from the route path
        user: Authenticated user
        db: Active database session
    """
    await delete_import_rule(db, user, rule_id)
