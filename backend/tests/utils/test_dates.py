"""Stored timezone resolution tests"""

import pytest
from fastapi import HTTPException, status

from app.utils.dates import ACCOUNT_OWNER_PROFILE, resolve_timezone

# An identifier no release of the IANA database carries, standing in for one that stopped
# resolving after the zone database moved underneath a row already written
UNRESOLVABLE_IDENTIFIER = "Mars/Olympus_Mons"

# ZoneInfo rejects these before it looks anything up, so they take the other failure path
PATH_SHAPED_IDENTIFIERS = ("/etc/passwd", "../etc/passwd", "")


def test_a_real_identifier_resolves():
    """The resolver is transparent for a zone the build carries"""
    assert resolve_timezone("America/Toronto").key == "America/Toronto"


def test_an_unresolvable_identifier_is_refused():
    """A stored zone that no longer resolves refuses the request rather than reaching a date"""
    with pytest.raises(HTTPException) as raised:
        resolve_timezone(UNRESOLVABLE_IDENTIFIER)

    assert raised.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_the_refusal_quotes_the_stored_value():
    """The reader is told which value failed, since nothing else on the page would say"""
    with pytest.raises(HTTPException) as raised:
        resolve_timezone(UNRESOLVABLE_IDENTIFIER)

    assert UNRESOLVABLE_IDENTIFIER in raised.value.detail


def test_the_refusal_says_whose_profile_the_value_came_from():
    """A group account reads its owner's zone, so the reader is not sent to their own settings"""
    with pytest.raises(HTTPException) as raised:
        resolve_timezone(UNRESOLVABLE_IDENTIFIER, stored_on=ACCOUNT_OWNER_PROFILE)

    assert ACCOUNT_OWNER_PROFILE in raised.value.detail
    assert "your profile" not in raised.value.detail


@pytest.mark.parametrize("identifier", PATH_SHAPED_IDENTIFIERS)
def test_a_path_shaped_identifier_is_refused(identifier):
    """A stored value shaped like a path is refused the same way rather than raising ValueError"""
    with pytest.raises(HTTPException) as raised:
        resolve_timezone(identifier)

    assert raised.value.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
