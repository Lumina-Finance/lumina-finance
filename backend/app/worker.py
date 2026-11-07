"""Bank sync worker process, run as `python -m app.worker`

With no arguments it runs the bank sync worker until stopped. With `check-health` it
exits 0 while the worker's heartbeat is fresh and 1 otherwise, for the container health check
"""

import asyncio
import logging
import os
import sys
import time

# Loads backend/.env. That is where a checkout run outside Docker, such as a development
# instance, keeps the database role passwords the wait below looks for
import app.config  # noqa: F401
from app.db.credentials import resolve_role_password

# Named rather than taken from __name__. That is __main__ when run as a module
logger = logging.getLogger("app.worker")

# How often to look for the password while waiting, the same as the database retries that follow
_PASSWORD_RETRY_SECONDS = 5


def _wait_for_app_role_password() -> None:
    """Return once the app database role's password exists. The app's container creates it on a fresh install"""
    logged = False
    while True:
        try:
            resolve_role_password("app", generate=False)
        except RuntimeError:
            if not logged:
                logger.info("Bank sync worker waiting to start: the app hasn't created its database role yet")
                logged = True
            time.sleep(_PASSWORD_RETRY_SECONDS)
        else:
            return


def main(arguments: list[str]) -> int:
    """Run the worker, or check its health, and return the exit status

    The worker's code is imported only once the password exists, since the database engine is
    built from it on import

    Args:
        arguments: The command-line arguments after the module name
    """
    # The app's own messages, leaving out what the libraries log as they load
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("app").setLevel(logging.INFO)
    if arguments == ["check-health"]:
        from app.services.bank_sync.worker import check_worker_health

        return 0 if asyncio.run(check_worker_health()) else 1
    if arguments:
        logger.error("Usage: python -m app.worker [check-health]")
        return os.EX_USAGE

    _wait_for_app_role_password()
    from app.services.bank_sync.worker import run_worker

    asyncio.run(run_worker())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
