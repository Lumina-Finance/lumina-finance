"""Inserting import records without failing on one another request has just written"""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import ColumnElement
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession


async def insert_import_records_if_absent(
    db: AsyncSession,
    model: type[Any],
    values: list[dict[str, Any]],
    index_elements: Sequence[Any],
    index_where: ColumnElement[bool],
) -> Sequence[Any]:
    """Insert import records, leaving alone any whose name is already taken

    A whole import lands in one transaction, and a statement that fails inside one takes the rest of
    it down unless every insert sits in a savepoint of its own. Asking the insert to skip what is
    already there avoids the failure rather than recovering from it, which is what lets two imports
    both needing a new category of one name write it once and reuse it for the other

    Args:
        db: Active database session
        model: Model being inserted
        values: One dictionary of column values per record
        index_elements: What the unique index is built on, so the insert knows which clash to skip
        index_where: The unique index's own condition, without which a partial index is not matched

    Returns:
        The records this insert wrote, leaving out every one that was already there
    """
    result = await db.execute(
        insert(model)
        .values(values)
        .on_conflict_do_nothing(index_elements=index_elements, index_where=index_where)
        .returning(model),
    )
    return result.scalars().all()
