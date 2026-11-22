"""Known-browser cookie tests

Guards that only a cookie this server made for an address puts a sign-in in the browser's own lockout
bucket, so a stranger can't claim a bucket by crafting one, and that a shared browser keeps every
address it signed in to
"""

import uuid

import pytest

from app.services.auth.known_browser import MAX_ADDRESSES, SHARED_BUCKET, remember_address, session_bucket, sign_in_bucket

_OWNER = "owner@example.com"
_HOUSEMATE = "housemate@example.com"


def _flip_last_character(value: str) -> str:
    """Return the value with its final hex digit changed, so it no longer matches what was made"""
    return value[:-1] + ("0" if value[-1] != "0" else "1")


def test_a_cookie_vouches_for_its_address_in_any_capitals_and_no_other():
    """The browser's bucket applies to the address it signed in to, spelled in any case, and to no other address"""
    cookie = remember_address(None, _OWNER)

    owner_bucket = sign_in_bucket(cookie, _OWNER)

    assert owner_bucket != SHARED_BUCKET, "the owner's browser counts apart from strangers"
    assert sign_in_bucket(cookie, _OWNER.upper()) == owner_bucket, "a spelling in other capitals is the same address"
    assert sign_in_bucket(cookie, _HOUSEMATE) == SHARED_BUCKET, "another address counts as no cookie"
    assert sign_in_bucket(None, _OWNER) == SHARED_BUCKET, "no cookie counts in the shared bucket"


def test_each_browser_gets_its_own_bucket():
    """Two browsers signed in to one address count apart, so one browser's failures never lock the other"""
    assert sign_in_bucket(remember_address(None, _OWNER), _OWNER) != sign_in_bucket(remember_address(None, _OWNER), _OWNER)


def _unusable_values() -> dict[str, str]:
    """Return values a client could send, none of which this server made for the owner's address"""
    cookie = remember_address(None, _OWNER)
    browser_id, mac = cookie.split(".")
    return {
        "forged mac": f"{browser_id}.{_flip_last_character(mac)}",
        "mac from another browser": f"{browser_id}.{remember_address(None, _OWNER).split('.')[1]}",
        "no mac": browser_id,
        "more addresses than the cap": ".".join([browser_id, *[mac] * (MAX_ADDRESSES + 1)]),
        "malformed id": f"{browser_id[:-1]}!.{mac}",
        "oversized": "a" * 5000,
    }


@pytest.mark.parametrize("value", list(_unusable_values().values()), ids=list(_unusable_values()))
def test_unusable_values_count_as_no_cookie(value):
    """A forged, malformed or oversized value is the shared bucket, never an error, so a crafted cookie gains nothing"""
    assert sign_in_bucket(value, _OWNER) == SHARED_BUCKET


def test_a_second_address_keeps_the_first_and_the_browser():
    """Signing in to another address from the same browser keeps the first one known, in the same bucket"""
    first = remember_address(None, _OWNER)

    both = remember_address(first, _HOUSEMATE)

    assert sign_in_bucket(both, _OWNER) == sign_in_bucket(first, _OWNER), "the owner's bucket is unchanged by the housemate's sign-in"
    assert sign_in_bucket(both, _HOUSEMATE) != SHARED_BUCKET, "the housemate's address is known too"
    assert both.split(".")[0] == first.split(".")[0], "the browser id stays"

    again = remember_address(both, _OWNER)
    assert len(again.split(".")) == len(both.split(".")), "signing in again to a known address adds no second MAC"


def test_a_sixth_address_makes_the_browser_forget_the_oldest():
    """A browser keeps at most the cap of addresses, the newest first, so the cookie stays small"""
    emails = [f"person{number}@example.com" for number in range(MAX_ADDRESSES + 1)]
    cookie = None
    for email in emails:
        cookie = remember_address(cookie, email)

    assert sign_in_bucket(cookie, emails[0]) == SHARED_BUCKET, "the oldest address is forgotten"
    assert all(sign_in_bucket(cookie, email) != SHARED_BUCKET for email in emails[1:]), "the newest addresses stay known"


def test_session_buckets_differ_by_session_and_from_browser_buckets():
    """Each session counts its step-up failures apart, and never in a bucket a browser's cookie could reach"""
    first, second = uuid.uuid4(), uuid.uuid4()

    assert session_bucket(first) == session_bucket(first)
    assert session_bucket(first) != session_bucket(second)
    assert session_bucket(first) != SHARED_BUCKET
    assert session_bucket(first) != sign_in_bucket(remember_address(None, _OWNER), _OWNER)
