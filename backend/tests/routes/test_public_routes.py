"""A new route must not fall unnoticed on the wrong side of a token verifier in front of the app

The verifier lets the routes that need no access token through and checks the rest. This reads the route
table instead of calling each route, because the question is which dependencies a route has, not what it
answers. A route a test module adds to the app is left out, since it is no part of the API
"""

from fastapi.dependencies.models import Dependant

from app.dependencies import get_authenticated_user
from tests.routes.support.route_helpers import served_routes

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
    # Single sign-on and the handoff to a native app both start before any access token exists
    ("POST", "/auth/oidc/{slug}/authorize"),
    ("POST", "/auth/oidc/callback"),
    ("POST", "/auth/oidc/signup"),
    ("POST", "/auth/native/exchange"),
}

# More than this many routes means the walk found the real table, not a wrapper standing in for one
MIN_ROUTES_SEEN = 100


def _needs_access_token(dependant: Dependant) -> bool:
    """Return whether the route or any dependency beneath it checks the access token"""
    return dependant.call is get_authenticated_user or any(_needs_access_token(inner) for inner in dependant.dependencies)


def test_routes_answering_without_an_access_token_are_exactly_the_listed_ones():
    """A route that needs no access token is listed on purpose, and every listed route still exists"""
    api_routes = [(path, route) for path, route in served_routes() if not route.endpoint.__module__.startswith("tests.")]
    public = {(method, path) for path, route in api_routes if not _needs_access_token(route.dependant) for method in route.methods}

    assert len(api_routes) > MIN_ROUTES_SEEN, "The walk found too few routes to be the whole table"
    assert sorted(public - PUBLIC_ROUTES) == [], "These routes answer without an access token but are not listed"
    assert sorted(PUBLIC_ROUTES - public) == [], "These listed routes are missing or now need an access token"
