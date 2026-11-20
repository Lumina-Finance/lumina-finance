"""The shapes a typed second-factor code can take, so only a code that could be real is ever checked"""

import re

# Six ASCII digits, shown by an authenticator app as one block or as two groups of three. The digit
# class is spelled out because the usual shorthand also matches digits of other scripts. The comparison
# against the real code cannot take those
_AUTHENTICATOR_CODE = re.compile(r"([0-9]{3})[ -]?([0-9]{3})")


def normalize_authenticator_code(code: str) -> str | None:
    """Return an authenticator code as its six digits, or None when the text is not one

    Surrounding whitespace is dropped and one space or hyphen between the two groups of three is
    accepted, so a code pasted as the app displays it checks as typed

    Args:
        code: Text the user submitted

    Returns:
        The six ASCII digits, or None when the text has any other shape
    """
    match = _AUTHENTICATOR_CODE.fullmatch(code.strip())
    return match.group(1) + match.group(2) if match else None
