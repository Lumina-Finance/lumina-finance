"""Column types carrying meaning the rotation and the guards read"""

from sqlalchemy import MetaData, Text
from sqlalchemy.types import TypeDecorator


class EncryptedText(TypeDecorator):
    """Text holding a Fernet token, labelled so the key rotation can find it

    This deliberately performs no encryption. Call sites encrypt and decrypt through
    app.encryption, and the type exists so that a column holding a secret is recognizable
    from the schema whatever it is called. Moving encryption in here would rewrite every
    call site and leave the rotation having to bypass its own column type to hold two keys
    at once, so the label stays inert

    Any column declared with this type is re-encrypted by the rotation, so a new column
    holding a Fernet token must use it rather than plain Text
    """

    impl = Text

    # The type carries no parameters, so SQLAlchemy can safely cache statements using it
    cache_ok = True


def find_encrypted_columns(metadata: MetaData) -> list[tuple[str, str]]:
    """Return every encrypted column in a schema as table and column name pairs

    Args:
        metadata: Schema to read, passed in rather than read from the shared metadata so
            a caller can probe a throwaway schema without registering a table globally

    Returns:
        Table and column name pairs, ordered by table then column
    """
    return sorted(
        (table.name, column.name)
        for table in metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, EncryptedText)
    )
