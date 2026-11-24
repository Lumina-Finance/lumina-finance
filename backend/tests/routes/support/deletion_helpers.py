"""Reading what a profile deletion left, for tests that it leaves the database as it was without the user"""

import uuid

from sqlalchemy import func, select

from app.models.base import Base
from app.models.user import User
from tests.conftest import TestSession


async def _row_counts() -> dict[str, int]:
    """Every table's row count"""
    async with TestSession() as session:
        return {table.name: await session.scalar(select(func.count()).select_from(table)) for table in Base.metadata.sorted_tables}


async def _user_exists(user_id: uuid.UUID) -> bool:
    """Whether the user row is still there"""
    async with TestSession() as session:
        return await session.scalar(select(func.count()).select_from(User).where(User.id == user_id)) == 1
