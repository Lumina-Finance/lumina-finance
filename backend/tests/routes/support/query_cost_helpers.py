"""Counting the rows a transaction reads from a table, for tests that hold a statement's cost to the rows it needs"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# How many rows a statement may read beyond those it returns, deletes or looks up. Reading through more
# than a handful of rows it has no use for fails the test
SLACK = 5

# The rows this transaction has read from a table so far, by sequential scans of it and entries
# returned by its indexes, including index-only scans that never visit the table, and including
# what any function or foreign key check it ran read
_ROWS_READ = text(
    "SELECT pg_stat_get_xact_tuples_returned(c.oid)"
    " + coalesce((SELECT sum(pg_stat_get_xact_tuples_returned(i.indexrelid)) FROM pg_index i WHERE i.indrelid = c.oid), 0)"
    " FROM pg_class c WHERE c.oid = to_regclass(:table)"
)


async def _rows_read(session: AsyncSession, table: str) -> int:
    """Return how many rows of a table this transaction has read so far"""
    return (await session.execute(_ROWS_READ, {"table": table})).scalar_one()


async def _avoid_full_scans(session: AsyncSession) -> None:
    """Have the planner take any plan other than a sequential scan for the rest of the transaction"""
    await session.execute(text("SET LOCAL enable_seqscan = off"))
