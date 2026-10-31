"""What a name found in an import is matched under, which merchants and tags share"""

from collections.abc import Iterable

from sqlalchemy import String, func, literal, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.ext.asyncio import AsyncSession


def select_requested_names(names: Iterable[str]):
    """Return the given names as a table the database can compare with stored names

    Sent as one array rather than a row of parameters each, so a file with a hundred thousand
    names is one parameter

    Args:
        names: Names to send, repeats allowed

    Returns:
        A table with one "name" column holding each distinct name
    """
    return func.unnest(literal(sorted(set(names)), ARRAY(String))).table_valued("name").render_derived()


async def load_import_name_keys(db: AsyncSession, names: Iterable[str]) -> dict[str, str]:
    """Return what each name is matched under during an import

    Compared without regard to capitalisation, so an import reaches the verdict the routes creating
    and renaming the same record reach. The database lowercases rather than Python, since the two
    disagree on some letters, such as "İ", and the unique indexes an import must agree with are
    built on the database's lower(name)

    Args:
        db: Active database session
        names: Trimmed names from import rows and answers, repeats allowed

    Returns:
        The key each distinct name is matched under
    """
    names = set(names)
    if not names:
        return {}

    requested = select_requested_names(names)
    rows = await db.execute(select(requested.c.name, func.lower(requested.c.name)))
    return {name: key for name, key in rows.all()}
