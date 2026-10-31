"""How much the app and its web server write to their logs"""

import logging
import os

_LOG_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
}

_configured_level = os.getenv("LOG_LEVEL", "").strip()
if _configured_level.upper() not in ("", *_LOG_LEVELS):
    raise RuntimeError(f"Invalid LOG_LEVEL={_configured_level!r}. Must be one of: {', '.join(_LOG_LEVELS)}")

LOG_LEVEL = _LOG_LEVELS[_configured_level.upper() or "INFO"]
