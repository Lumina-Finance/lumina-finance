"""Runtime mode, application version, API docs, public origin, and CORS settings"""

import os

from app.config.env import optional_bool_env, optional_csv_env, unique_values

RUNTIME = os.getenv("RUNTIME", "server").strip() or "server"
if RUNTIME not in ("server", "lambda"):
    raise RuntimeError(f"Invalid RUNTIME={RUNTIME!r}. Must be one of: server, lambda")


def is_update_check_enabled(runtime: str, configured_enabled: bool) -> bool:
    """Return whether update checks are allowed for the current runtime

    Args:
        runtime: Application runtime mode
        configured_enabled: Public update check setting

    Returns:
        Whether update checks may run
    """
    return runtime == "server" and configured_enabled


APP_VERSION = os.getenv("APP_VERSION", "").strip()
UPDATE_CHECKS_ENABLED = is_update_check_enabled(
    RUNTIME,
    optional_bool_env("UPDATE_CHECKS_ENABLED", default=False),
)

# Serves /docs, /redoc and /openapi.json. Off by default in every runtime, so the API publishes
# no map of every route unless asked to
API_DOCS_ENABLED = optional_bool_env("API_DOCS_ENABLED", default=False)

APP_URL = os.getenv("APP_URL", "").strip()

# A runtime that serves the API apart from the frontend needs the frontend's origin for CORS as
# well as for the links it emails
if RUNTIME == "lambda" and not APP_URL:
    raise RuntimeError("Missing required environment variable: APP_URL, which RUNTIME=lambda requires")

# APP_URL is the public CORS origin. ALLOWED_ORIGINS appends extra internal origins. With neither
# set, no other origin is allowed, since the packaged image serves the frontend and API together
_configured_origins = [APP_URL, *optional_csv_env("ALLOWED_ORIGINS")]
ALLOWED_ORIGINS = unique_values([origin for origin in _configured_origins if origin])
