"""Refusal for a migration downgrade that would drop tables still holding data"""

from sqlalchemy import Connection, text


def refuse_while_tables_hold_rows(connection: Connection, losses: dict[str, str]) -> None:
    """Raise before a downgrade drops tables that still hold rows, naming what would be lost

    A downgrade that drops a table drops its rows with it, and nothing can bring them back,
    so it refuses instead and leaves whoever runs the downgrade to restore a backup or remove the
    data deliberately

    Args:
        connection: Connection the downgrade runs on
        losses: What each table's rows are, keyed by table name, as the message should name them

    Raises:
        RuntimeError: At least one of the tables holds rows
    """
    held = [
        description
        for table, description in losses.items()
        # Table names come from the migration itself, never from input, so they are safe to interpolate
        if connection.execute(text(f"SELECT EXISTS (SELECT 1 FROM public.{table})")).scalar()  # noqa: S608
    ]
    if held:
        raise RuntimeError(
            f"Refusing to roll back: it would delete {', '.join(held)}. Remove them first, or restore a backup taken before this migration"
        )
