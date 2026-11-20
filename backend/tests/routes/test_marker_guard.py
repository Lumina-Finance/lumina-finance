"""The guard that fails a route test when a signed-in write leaves the user's change markers unmoved

Every route test runs through it, so what is proved here is that it catches a writer that forgot to mark
and does not stop writes that were refused or that were not signed in
"""

import pytest

from app.main import app
from app.routes import institution as institution_routes
from tests.routes.support import _create_user, _get_auth_header
from tests.routes.support.marker_guard import UNMARKED_WRITE_ROUTES

_INSTITUTION = {"name": "Guarded Bank", "country_code": "CA", "website": "https://guarded.example.com"}


async def test_a_write_route_that_forgets_to_mark_fails_the_guard(client, monkeypatch):
    """Removing the institution writer's mark makes the successful create fail, naming the route"""
    headers = _get_auth_header(await _create_user(client))

    async def forget_to_mark(*_args):
        """Do what the writer did before it marked"""

    monkeypatch.setattr(institution_routes, "mark_shared_cache_changed", forget_to_mark)

    with pytest.raises(AssertionError, match="POST /institutions answered 201"):
        await client.post("/institutions", json=_INSTITUTION, headers=headers)


async def test_a_marking_writer_a_refused_write_and_a_signed_out_write_pass_the_guard(client):
    """The writer that marks passes, a refusal changes nothing to mark, and a request with no sign-in has no user's marker to move"""
    headers = _get_auth_header(await _create_user(client))

    assert (await client.post("/institutions", json=_INSTITUTION, headers=headers)).status_code == 201
    assert (await client.post("/institutions", json=_INSTITUTION, headers=headers)).status_code == 409
    assert (await client.post("/institutions", json=_INSTITUTION)).status_code == 401


def test_every_exempt_route_is_a_real_route():
    """A renamed or removed route cannot stay in the exempt list, where its entry would silently exempt nothing"""
    served = {f"{method.upper()} {path}" for path, methods in app.openapi()["paths"].items() for method in methods}

    assert sorted(set(UNMARKED_WRITE_ROUTES) - served) == []


async def test_the_opt_out_ends_with_its_block(client, monkeypatch):
    """A forgetting writer passes inside expecting_no_change and fails on the next write after it"""
    headers = _get_auth_header(await _create_user(client))

    async def forget_to_mark(*_args):
        """Do what the writer did before it marked"""

    monkeypatch.setattr(institution_routes, "mark_shared_cache_changed", forget_to_mark)

    with client.expecting_no_change():
        inside = await client.post("/institutions", json=_INSTITUTION, headers=headers)
    assert inside.status_code == 201, inside.text

    with pytest.raises(AssertionError, match="POST /institutions answered 201"):
        await client.post("/institutions", json={**_INSTITUTION, "name": "Second Bank"}, headers=headers)
