"""Shared handling for the names a user gives a record"""

from typing import Annotated, Any

from pydantic import BeforeValidator


def _trim_name(value: Any) -> Any:
    """Trim surrounding spaces from a name on the way in

    Args:
        value: Field value as it arrived in the request body

    Returns:
        The name without surrounding spaces, or the value unchanged when it is not text, which
        leaves the field's own type check to refuse it
    """
    return value.strip() if isinstance(value, str) else value


# A name the user chose, stored without surrounding spaces. Two names differing only in those
# spaces would otherwise both be storable while the routes and the unique indexes, which compare
# the trimmed name, read them as one. Trimming here also runs before the length check, so a name
# of nothing but spaces is refused rather than stored empty
TrimmedName = Annotated[str, BeforeValidator(_trim_name)]
