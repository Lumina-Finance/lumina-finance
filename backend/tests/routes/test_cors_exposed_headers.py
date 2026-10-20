from app.config.runtime import ALLOWED_ORIGINS


async def test_cross_origin_response_exposes_the_headers_the_client_reads(client):
    """A browser on another origin can read both response headers the client depends on

    The bearer challenge tells an expired token from a wrong credential, and the attempts count
    drives the lockout warning. A header left out of the list is hidden from a cross-origin
    page without any error, so the warning silently never shows
    """
    # The test environment sets APP_URL, so the CORS layer is installed with it as an origin
    origin = ALLOWED_ORIGINS[0]

    response = await client.get("/health", headers={"Origin": origin})

    exposed = {name.strip().lower() for name in response.headers["access-control-expose-headers"].split(",")}
    assert exposed == {"www-authenticate", "x-auth-attempts-remaining"}
