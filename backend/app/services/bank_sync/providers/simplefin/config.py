"""SimpleFIN's settings, read once as the provider loads"""

import logging

from app.config.bank_sync import provider_setting_key, read_count_setting, read_origin_list_setting, read_test_origin_setting

logger = logging.getLogger(__name__)

PROVIDER_ID = "simplefin"

# SimpleFIN Bridge's two servers, always allowed. Servers set in the environment are added beside
# them, so connections already made through the Bridge keep working
SIMPLEFIN_BRIDGE_ORIGINS = ["https://beta-bridge.simplefin.org", "https://bridge.simplefin.org"]

ORIGINS_KEY = provider_setting_key(PROVIDER_ID, "ORIGINS")
TEST_ORIGIN_KEY = provider_setting_key(PROVIDER_ID, "TEST_ORIGIN")
HISTORY_MONTHS_KEY = provider_setting_key(PROVIDER_ID, "HISTORY_MONTHS")
DAILY_REQUESTS_KEY = provider_setting_key(PROVIDER_ID, "DAILY_REQUESTS")


def read_simplefin_origins() -> list[str]:
    """Return the origins SimpleFIN requests may reach: SimpleFIN Bridge's, then any the environment adds

    Raises:
        RuntimeError: An added entry is not an HTTPS origin
    """
    return [*SIMPLEFIN_BRIDGE_ORIGINS, *read_origin_list_setting(ORIGINS_KEY)]


def warn_if_test_origin_set() -> None:
    """Warn while the testing-only origin is set. The app and the bank sync worker each do so as they start"""
    if SIMPLEFIN_TEST_ORIGIN:
        logger.warning(
            "%s sends SimpleFIN requests only to %s, without HTTPS or the public address check, "
            "and refuses every other origin, SimpleFIN Bridge's included. It is for testing only",
            TEST_ORIGIN_KEY,
            SIMPLEFIN_TEST_ORIGIN,
        )


# Origins SimpleFIN requests may reach while no test origin is set, always over HTTPS and only at
# public addresses
SIMPLEFIN_ORIGINS = read_simplefin_origins()

# Testing only: while set, the one origin SimpleFIN requests may reach, exempt from the HTTPS and
# public address checks, so development instances and browser tests reach a fake SimpleFIN Bridge on
# a private network and nothing else, not even a real connection restored from production. Unset by
# default and kept out of the environment variable docs, and the app and the bank sync worker each
# warn as they start while it is set
SIMPLEFIN_TEST_ORIGIN = read_test_origin_setting(TEST_ORIGIN_KEY)

# How many calendar months back a SimpleFIN import may start. A change applies only to start
# dates chosen afterwards
SIMPLEFIN_HISTORY_MONTHS = read_count_setting(HISTORY_MONTHS_KEY, 12)

# Requests each SimpleFIN connection may send in a rolling 24 hours, below the 24 a day SimpleFIN
# Bridge expects, so setup and retries never earn a warning that could get the token disabled. A
# higher value than the 24 is refused at start
SIMPLEFIN_DAILY_REQUESTS = read_count_setting(DAILY_REQUESTS_KEY, 20, maximum=24)
