"""Timezone identifier validation tests"""

import zoneinfo
from datetime import datetime
from importlib.util import find_spec
from zoneinfo import ZoneInfo

import pytest

from app.schemas.auth import validate_iana_timezone

# Compatibility identifiers IANA keeps for places it has renamed. Debian 13 ships these in a
# tzdata-legacy package the runtime image does not install, so in the container they exist only
# because the tzdata dependency supplies them
LEGACY_IDENTIFIERS = (
    "America/Indianapolis",
    "US/Eastern",
    "Asia/Calcutta",
    "Europe/Kiev",
)

# Any fixed instant will do, since the assertion is that the zone carries usable rules at all
_WINTER_INSTANT = datetime(2026, 1, 15, 12, 0)


def test_the_tzdata_package_is_installed():
    """The zone database has to come from the dependency rather than the base image"""
    assert find_spec("tzdata") is not None


def test_zone_lookups_ignore_the_operating_system():
    """One release of the IANA database is in play, whatever zone files the host carries

    Importing anything from app empties the search path, so a zone present both in the package
    and on the host cannot resolve to the host's older version of it
    """
    assert zoneinfo.TZPATH == ()


@pytest.mark.parametrize("identifier", LEGACY_IDENTIFIERS)
def test_a_legacy_identifier_is_accepted(identifier):
    """A timezone picker offering a compatibility identifier does not produce a rejected signup"""
    assert validate_iana_timezone(identifier) == identifier


@pytest.mark.parametrize("identifier", LEGACY_IDENTIFIERS)
def test_a_legacy_identifier_constructs_a_zone(identifier):
    """Accepting an identifier the routes cannot then construct would move the failure to a 500"""
    assert ZoneInfo(identifier).utcoffset(_WINTER_INSTANT) is not None


def test_an_unrecognized_identifier_is_rejected():
    """Widening the accepted set must not stop it rejecting a value that is not a timezone"""
    with pytest.raises(ValueError, match="Invalid IANA timezone"):
        validate_iana_timezone("Mars/Olympus_Mons")
