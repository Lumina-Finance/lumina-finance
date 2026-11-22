"""The service name slot that code building on the app sets

The slot is set in code and is never read from the environment, so no configuration of the published
image can name the service something else
"""

# The name code outside the app set, or None while none has. Each reader takes the name at its own
# moment: the passkey prompt when building its options, an email's title and any wording naming
# the service when building the email, and its From header when sending the email. An email built
# before a change and sent after therefore carries the old name in its body and the new name in its
# From header
_service_name: str | None = None


def set_service_name(name: str) -> None:
    """Name the service in email sender names, email bodies and passkey prompts

    Args:
        name: The name to show, replacing the fixed names the app shows while none is set

    Raises:
        TypeError: The name is not text
        ValueError: The name is blank, has spaces at either end or has a character that does not print
    """
    global _service_name
    if not isinstance(name, str):
        raise TypeError("The service name must be text")
    if not name or name != name.strip() or not name.isprintable():
        raise ValueError("The service name must be text with no spaces at either end and only characters that print")
    _service_name = name


def resolve_service_name(default: str) -> str:
    """Return the name set in code, or the given fixed name while none is set"""
    return default if _service_name is None else _service_name
