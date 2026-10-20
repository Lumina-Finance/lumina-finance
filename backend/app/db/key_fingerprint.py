"""Read and record the fingerprint a database keeps of a key its data depends on

Each such key has a single-row table holding the SHA-256 digest of the key in use, so a start or
a provisioning step under any other key can be refused before it breaks the data
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models.encryption_key import SINGLETON_ID


async def table_exists(connection: AsyncConnection, table: str) -> bool:
    """Whether a public table is present in the database"""
    qualified = await connection.scalar(text("SELECT to_regclass(:qualified)"), {"qualified": f"public.{table}"})
    return qualified is not None


async def read_fingerprint(connection: AsyncConnection, table: str) -> str | None:
    """Return the fingerprint recorded in a table, or None when nothing is recorded yet

    Args:
        connection: Open connection to the application database
        table: The fingerprint table, a fixed name from the code rather than input

    Returns:
        The recorded SHA-256 hex digest, or None when the table or the row is absent
    """
    if not await table_exists(connection, table):
        return None

    return await connection.scalar(
        text(f"SELECT fingerprint FROM public.{table} WHERE id = :id"),  # noqa: S608
        {"id": SINGLETON_ID},
    )


async def record_fingerprint(connection: AsyncConnection, table: str, fingerprint: str) -> None:
    """Record a key's fingerprint in a table, replacing any earlier record

    Args:
        connection: Open connection inside the transaction the record belongs to
        table: The fingerprint table, a fixed name from the code rather than input
        fingerprint: The SHA-256 hex digest of the key now in use
    """
    # Upsert the single row, so recording after a rotation or a reset replaces the previous key
    await connection.execute(
        text(
            f"INSERT INTO public.{table} (id, fingerprint) VALUES (:id, :fingerprint) "  # noqa: S608
            f"ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, updated_at = now()"
        ),
        {"id": SINGLETON_ID, "fingerprint": fingerprint},
    )
