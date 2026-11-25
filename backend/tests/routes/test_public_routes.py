"""A new route must not fall unnoticed on the wrong side of a token verifier in front of the app

The verifier reads the access token from the Authorization header. It lets through the routes that need no
access token and the routes that carry theirs elsewhere, and checks the rest. This reads the route table
instead of calling each route, because the question is which dependencies a route has, not what it answers.
A route a test module adds to the app is left out, since it is no part of the API
"""

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.dependencies import get_authenticated_user, get_user_who_may_cancel_deletion
from tests.routes.support.route_helpers import served_routes

# The dependencies that check the access token. The second lets a profile waiting to be deleted through to cancel
ACCESS_TOKEN_CHECKS = {get_authenticated_user, get_user_who_may_cancel_deletion}

# Every route that answers without an access token. Some take another proof instead, such as a refresh cookie,
# a one-time token in the body or a sign-in step's challenge, and some are open to everyone
PUBLIC_ROUTES = {
    # The verifier's own lookups
    ("GET", "/auth/.well-known/jwks.json"),
    ("GET", "/auth/.well-known/openid-configuration"),
    # Facts and probes any caller may read
    ("GET", "/health"),
    ("GET", "/version"),
    ("GET", "/currencies"),
    ("GET", "/currencies/{currency_id}"),
    ("GET", "/auth/registration"),
    ("GET", "/auth/oidc/providers"),
    ("GET", "/auth/passkeys/config"),
    # Sign-up
    ("POST", "/auth/signup"),
    ("POST", "/auth/signup/confirm"),
    # Sign-in, its second factor, and the tokens that outlive an access token
    ("POST", "/auth/login"),
    ("POST", "/auth/2fa/verify"),
    ("POST", "/auth/refresh"),
    ("POST", "/auth/logout"),
    ("POST", "/auth/passkeys/authenticate"),
    ("POST", "/auth/passkeys/authenticate/options"),
    ("POST", "/auth/passkeys/mfa/options"),
    ("POST", "/auth/passkeys/mfa/verify"),
    # Password reset
    ("POST", "/auth/password/forgot"),
    ("POST", "/auth/password/reset"),
    ("POST", "/auth/password/reset/check"),
    ("POST", "/auth/password/reset/verify"),
    ("POST", "/auth/passkeys/reset/options"),
    ("POST", "/auth/passkeys/reset/verify"),
    # An email change is confirmed by a one-time token from the new address, often in a browser with no session
    ("POST", "/auth/email/change/confirm"),
    # Single sign-on and the app's code exchange both start before any access token exists
    ("POST", "/auth/oidc/{slug}/authorize"),
    ("POST", "/auth/oidc/callback"),
    ("POST", "/auth/oidc/signup"),
    ("POST", "/auth/native/exchange"),
}

# More than this many routes means the walk found the real table, not a wrapper standing in for one
MIN_ROUTES_SEEN = 100


def _needs_access_token(dependant: Dependant) -> bool:
    """Return whether the route or any dependency beneath it checks the access token"""
    return dependant.call in ACCESS_TOKEN_CHECKS or any(_needs_access_token(inner) for inner in dependant.dependencies)


def _api_routes() -> list[tuple[str, APIRoute]]:
    """Return the path and route of every route the app serves, leaving out routes a test module added"""
    return [(path, route) for path, route in served_routes() if not route.endpoint.__module__.startswith("tests.")]


def test_routes_answering_without_an_access_token_are_exactly_the_listed_ones():
    """A route that needs no access token is listed on purpose, and every listed route still exists"""
    api_routes = _api_routes()
    public = {(method, path) for path, route in api_routes if not _needs_access_token(route.dependant) for method in route.methods}

    assert len(api_routes) > MIN_ROUTES_SEEN, "The walk found too few routes to be the whole table"
    assert sorted(public - PUBLIC_ROUTES) == [], "These routes answer without an access token but are not listed"
    assert sorted(PUBLIC_ROUTES - public) == [], "These listed routes are missing or now need an access token"


# Every route that checks an access token it takes from somewhere other than the Authorization header, so a
# verifier reading the header finds none and must let the request through to the app's own check. A top-level
# form post can't set a header, so the app handoff's token arrives in a form field
TOKEN_OUTSIDE_HEADER_ROUTES = {
    ("POST", "/auth/native/handoff"),
}


def test_routes_taking_their_access_token_outside_the_header_are_exactly_the_listed_ones():
    """A route that feeds the check a token from outside the header is listed on purpose, and every listed route still exists

    Only a route class of its own can hand the check a token from elsewhere, since the check reads the header
    through its own dependency. A route reading a token through a dependency of its own skips the check and
    must join PUBLIC_ROUTES instead
    """
    outside_header = {
        (method, path)
        for path, route in _api_routes()
        if _needs_access_token(route.dependant) and type(route) is not APIRoute
        for method in route.methods
    }

    assert sorted(outside_header - TOKEN_OUTSIDE_HEADER_ROUTES) == [], "These routes take their token outside the header but are not listed"
    assert sorted(TOKEN_OUTSIDE_HEADER_ROUTES - outside_header) == [], "These listed routes are missing or now read the header"
