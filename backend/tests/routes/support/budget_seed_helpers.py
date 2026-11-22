"""Seeding many base budgets without going through the API"""

import uuid

from app.models.base import RecurrenceFreq
from app.models.budget import BaseBudget
from tests.conftest import TestSession


async def seed_base_budgets(owner_id, count, *, group_id=None, is_archived=False):
    """Insert base budgets for a user, or for a group when no owner is given

    Args:
        owner_id: Owning user's id as text, or None for group budgets
        count: Number of budgets to insert
        group_id: Owning group's id as text, for group budgets
        is_archived: Whether the budgets are archived
    """
    async with TestSession() as session:
        session.add_all(
            [
                BaseBudget(
                    owner_id=uuid.UUID(owner_id) if owner_id else None,
                    group_id=uuid.UUID(group_id) if group_id else None,
                    name=f"Seeded {index}",
                    currency="CAD",
                    recurrence_freq=RecurrenceFreq.MONTHLY,
                    instance_length=1,
                    recurrence_dom=1,
                    is_archived=is_archived,
                )
                for index in range(count)
            ]
        )
        await session.commit()
