"""SQL search text helpers"""


def escape_like_search_text(value: str) -> str:
    """Return search text escaped for a literal SQL LIKE match

    Args:
        value: User-provided search text

    Returns:
        Text with SQL LIKE wildcard characters escaped
    """
    escaped_value = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped_value
