"""Service name slot tests: what code building on the app may set, and what it gets back before and after"""

import pytest

from app.services.service_name import resolve_service_name, set_service_name


def test_resolve_gives_the_fixed_name_until_a_name_is_set():
    """With nothing set, the name the caller passes is the one that shows"""
    assert resolve_service_name("Fixed name") == "Fixed name"


def test_a_name_set_later_replaces_the_one_set_before():
    """A name set while the app is running shows from the next use on, and the latest name wins"""
    set_service_name("First name")
    assert resolve_service_name("Fixed name") == "First name"

    set_service_name("Second name")
    assert resolve_service_name("Fixed name") == "Second name"


@pytest.mark.parametrize("name", ["", " ", " Padded", "Padded ", "Two\nlines", "Tabbed\tname", "Null\x00name"])
def test_a_blank_padded_or_unprintable_name_is_refused_and_the_current_name_stays(name):
    """A name that would break a mail header or show as blank is refused, never trimmed to fit"""
    set_service_name("Current name")

    with pytest.raises(ValueError, match="service name"):
        set_service_name(name)

    assert resolve_service_name("Fixed name") == "Current name"


@pytest.mark.parametrize("name", [None, 5, b"Bytes name"])
def test_a_name_that_is_not_text_is_refused(name):
    """Only text can name the service"""
    with pytest.raises(TypeError, match="service name"):
        set_service_name(name)

    assert resolve_service_name("Fixed name") == "Fixed name"
