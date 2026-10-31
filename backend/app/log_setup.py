"""Applies the log level to the app's loggers and its web server's"""

import logging

from app.abuse_log import abuse_log

# The web server's loggers that set a level of their own. Its access log is switched off where the
# server starts, since each of its lines holds the full path and query string
_SERVER_LOGGERS = ("uvicorn", "uvicorn.error")

# Outside libraries never write below this: SQLAlchemy's lines hold statement values and httpx's
# hold outbound URLs, which can carry personal data and credentials
_OUTSIDE_LIBRARY_FLOOR = logging.WARNING


def configure_logging(level: int) -> None:
    """Set the level of every logger the app controls, once the web server has set up its own

    Args:
        level: Lowest level written
    """
    # Does nothing when the runtime has already installed a handler of its own
    logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger().setLevel(max(level, _OUTSIDE_LIBRARY_FLOOR))

    for name in ("app", *_SERVER_LOGGERS):
        logging.getLogger(name).setLevel(level)
    abuse_log.setLevel(level)
