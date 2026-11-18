"""Application version, update checks, public origin, and CORS settings"""

import os

from app.config.env import optional_bool_env, optional_csv_env, unique_values

APP_VERSION = os.getenv("APP_VERSION", "").strip()
UPDATE_CHECKS_ENABLED = optional_bool_env("UPDATE_CHECKS_ENABLED", default=False)

APP_URL = os.getenv("APP_URL", "").strip()

# APP_URL is the public CORS origin. ALLOWED_ORIGINS appends extra internal origins. With neither
# set, no other origin is allowed, since the packaged image serves the frontend and API together
_configured_origins = [APP_URL, *optional_csv_env("ALLOWED_ORIGINS")]
ALLOWED_ORIGINS = unique_values([origin for origin in _configured_origins if origin])
