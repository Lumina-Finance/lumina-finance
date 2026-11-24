"""A test client that fails when a signed-in write leaves what the user's screens show unmarked

The browser skips fetching data its change check says is unchanged, so a write that changes a screen
without moving the marker would leave old figures on it for good. Every route test already makes the
writes, so checking after each one covers every route and any route added later, with no recipe per route
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime

import httpx
import jwt
from sqlalchemy import text

from app.main import app
from tests.conftest import engine

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# Routes whose successful write changes nothing a screen shows, by method and path template, each with
# the reason. A route belongs here only for its reason being true of every request it answers, never
# because its test happened to leave the marker alone
UNMARKED_WRITE_ROUTES: dict[str, str] = {
    # Sign-in and account security. The app fetches these on every visit, never from its saved copy
    "POST /auth/logout": "Ends the session. Nothing a screen shows changes.",
    "PATCH /auth/password": "Changes the credential and ends other sessions. No screen shows either.",
    "POST /auth/2fa/setup": "Starts an enrolment that changes nothing until its confirmation.",
    "POST /auth/passkeys/register/options": "Issues a challenge and changes nothing a screen shows.",
    "POST /auth/passkeys/step-up/options": "Issues a challenge and changes nothing a screen shows.",
    "PATCH /auth/passkeys/{passkey_id}": "Renames a passkey, listed by a screen that fetches on every visit.",
    "POST /auth/oidc/{slug}/link": "Starts linking a sign-in provider and changes nothing until the provider answers.",
    "POST /auth/oidc/reauth": "Starts a fresh sign-in at the provider and changes nothing a screen shows.",
    "POST /auth/oidc/link/callback": "Finishes linking a sign-in provider, which a screen that fetches on every visit lists.",
    "POST /auth/oidc/reauth/callback": "Confirms a fresh sign-in at the provider and changes nothing a screen shows.",
    "POST /auth/2fa/complete": "Completes a sign-in or a step-up, and changes nothing a screen shows.",
    "POST /auth/password/set": "Sets a first password, which no screen shows.",
    "POST /auth/sessions/end-others": "Ends other sessions, which no screen shows.",
    "POST /auth/email/change": "Stores a request and emails a link, and the address changes only when the link is confirmed.",
    "POST /auth/profile/delete": "Deletes the profile and signs it out everywhere, so no screen of it is left to show anything.",
    "POST /auth/passkeys/register/confirm": "Activates a passkey, listed by a screen that fetches on every visit.",
    "POST /auth/oidc/identities/{identity_id}/remove": "Unlinks a sign-in provider, listed by a screen that fetches on every visit.",
    "POST /auth/2fa/disable": "Turns off two-step sign-in, shown by a screen that fetches on every visit.",
    "POST /auth/2fa/recovery-codes/confirm": "Swaps the recovery codes, which a screen shows once and never keeps.",
    "POST /auth/2fa/confirm": "Turns on two-step sign-in, shown by a screen that fetches on every visit.",
    "POST /auth/2fa/recovery-codes": "Replaces the recovery codes, which a screen shows once and never keeps.",
    "POST /auth/passkeys/register": "Adds a passkey, listed by a screen that fetches on every visit.",
    "POST /auth/passkeys/{passkey_id}/remove": "Removes a passkey, listed by a screen that fetches on every visit.",
    # Import staging. The run list is fetched on every visit, so no screen reads it from the saved copy
    "POST /transactions/import/runs": "Opens a staged upload that no screen shows until the run commits, and the commit marks.",
    "PUT /transactions/import/runs/{run_id}/archive": "Stages accounts to archive in an open run that no screen shows until the run commits.",
    "PUT /transactions/import/runs/{run_id}/budgets": "Stages budgets in an open run that no screen shows until the run commits.",
    "DELETE /transactions/import/runs/{run_id}": "Drops a run's staged rows, which no screen shows.",
    "POST /transactions/import/runs/{run_id}/rows": "Stages rows in an open run that no screen shows until the run commits.",
    "POST /transactions/import/runs/{run_id}/journal/rows": "Stages journal rows in an open run that no screen shows until the run commits.",
    "POST /transactions/import/runs/{run_id}/commit": "Asks for the save, whose commit marks, and repeats its summary.",
    "POST /transactions/import/runs/{run_id}/journal/commit": "Asks for the save, whose commit marks, and repeats its summary.",
    # Bank sign-in. Nothing shows until the connection is linked
    "POST /bank-sync/authorizations": "Starts signing in at the bank. Linking the connection afterwards marks.",
    # Lookups made with POST so the request can carry a body
    "POST /transactions/export": "Reads the ledger into a file and stores nothing.",
    "POST /tags/name-matches": "Reports which names already have a tag and stores nothing.",
    "POST /merchants/name-matches": "Reports which names already have a merchant and stores nothing.",
    "POST /transactions/import/held-bank-transactions": "Reports which bank transactions an account holds and stores nothing.",
}

type Markers = tuple[datetime | None, ...]

# Every marker the user's change check returns: their own data and status times, the shared one, and
# the latest of their groups'. A write to a group's data moves the group's alone, and the app does not
# compare it yet. The guard counts it here and nowhere else, so a group-owned write through an
# ordinary route passes
_READ_MARKERS = text(
    "SELECT"
    " (SELECT changed_at FROM user_cache_states WHERE user_id = :user_id),"
    " (SELECT status_changed_at FROM user_cache_states WHERE user_id = :user_id),"
    " (SELECT changed_at FROM shared_cache_state),"
    " (SELECT max(changed_at) FROM group_cache_states WHERE group_id IN (SELECT group_id FROM group_members WHERE user_id = :user_id))"
)


def _signed_in_user_id(headers: httpx.Headers) -> uuid.UUID | None:
    """Return the user a bearer token names, or None for a request that is not signed in"""
    scheme, _, token = headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        subject = jwt.decode(token, options={"verify_signature": False}).get("sub")
        return uuid.UUID(str(subject))
    except jwt.PyJWTError, ValueError:
        return None


async def _read_markers(user_id: uuid.UUID) -> Markers:
    """Return the user's data and status markers and the shared marker, at the database's full precision"""
    async with engine.connect() as connection:
        row = (await connection.execute(_READ_MARKERS, {"user_id": user_id})).one()
    return tuple(row)


def _has_moved(before: Markers, after: Markers) -> bool:
    """Whether any marker the user's check returns is later than it was, or newly set"""
    return any(new is not None and (old is None or new > old) for old, new in zip(before, after, strict=True))


class _RouteRecorder:
    """The app, noting which route template answered each method and path

    Built from the path parameters the router fills into the scope, since a route's own path leaves
    out its router's prefix and nested routers can't be searched from outside
    """

    def __init__(self, inner) -> None:
        """Wrap the app"""
        self.inner = inner
        self.templates: dict[tuple[str, str], str] = {}

    async def __call__(self, scope, receive, send) -> None:
        """Run the app, then record the matched template"""
        await self.inner(scope, receive, send)
        if scope["type"] != "http" or scope.get("route") is None:
            return
        names_by_value = {str(value): name for name, value in scope.get("path_params", {}).items()}
        segments = [f"{{{names_by_value[segment]}}}" if segment in names_by_value else segment for segment in scope["path"].split("/")]
        self.templates[(scope["method"], scope["path"])] = "/".join(segments)


class MarkerGuardClient(httpx.AsyncClient):
    """An HTTP client over the app that checks every successful signed-in write moved a marker the user's check returns"""

    def __init__(self) -> None:
        """Connect to the app under test"""
        self._recorder = _RouteRecorder(app)

        self._expects_no_change = False
        super().__init__(transport=httpx.ASGITransport(app=self._recorder), base_url="http://test")

    @contextmanager
    def expecting_no_change(self) -> Iterator[None]:
        """Stand the guard aside for the requests sent inside, which are meant to change nothing

        Wraps only a request that is empty, replayed or in effect already and so answers success
        while rightly leaving the markers where they were. The test's other writes stay guarded
        """
        self._expects_no_change = True
        try:
            yield
        finally:
            self._expects_no_change = False

    async def request(self, method: str, url: httpx.URL | str, **kwargs) -> httpx.Response:
        """Send a request, and after a successful signed-in write assert the caller's visible marker moved"""
        method = method.upper()
        user_id = _signed_in_user_id(httpx.Headers(kwargs.get("headers")))
        if method not in WRITE_METHODS or user_id is None or self._expects_no_change:
            return await super().request(method, url, **kwargs)

        before = await _read_markers(user_id)
        response = await super().request(method, url, **kwargs)
        path = response.request.url.path
        route = f"{method} {self._recorder.templates.get((method, path), path)}"
        if response.is_success and route not in UNMARKED_WRITE_ROUTES:
            after = await _read_markers(user_id)
            assert _has_moved(before, after), (
                f"{route} answered {response.status_code} and left the caller's change markers where they were. "
                "Its writer must mark the cache for its scope, or the route goes in UNMARKED_WRITE_ROUTES with the reason it changes no screen"
            )
        return response
