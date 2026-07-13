"""Run the backend with its data clock pinned to the capture day

The demo seed and the capture browser pin their calendars to a 15th, while
the backend resolves ranges like month to date from its own clock, so
captures need the server to agree on the pinned day. Auth modules keep the
real clock because the timestamps they write are validated against the
database's own clock, which cannot be pinned
"""

import argparse
from datetime import date, datetime, time

import uvicorn
from freezegun import freeze_time

PINNED_DAY_OF_MONTH = 15

# Midday UTC keeps the pinned moment on the same calendar day across the
# demo users' timezones
PINNED_HOUR_UTC = 12

# Modules that must keep the real clock: auth writes token and session
# expiry that the database clock validates on every request, app.dependencies
# and the jwt library check token claims stamped with that real clock
REAL_CLOCK_MODULES = ["app.services.auth", "app.routes.auth", "app.dependencies", "jwt"]


def _pinned_day() -> date:
    """Return the capture day, stepping back a month before the real 15th

    Mirrors the pinning rule in dev/dev-db/seed_demo_data.py and
    dev/screenshots/shared.mjs

    Returns:
        The 15th of the current month on or after the real 15th, otherwise
        the 15th of the previous month
    """
    real_today = date.today()
    if real_today.day >= PINNED_DAY_OF_MONTH:
        return real_today.replace(day=PINNED_DAY_OF_MONTH)
    if real_today.month == 1:
        return date(real_today.year - 1, 12, PINNED_DAY_OF_MONTH)
    return date(real_today.year, real_today.month - 1, PINNED_DAY_OF_MONTH)


def main() -> None:
    """Start the app under a ticking clock frozen to the pinned day"""
    parser = argparse.ArgumentParser(description="Run the backend pinned to the capture day")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()

    # The app must import before the clock freezes, because libraries define
    # date subclasses at import time and the frozen replacements break them
    from app.main import app

    pinned_start = datetime.combine(_pinned_day(), time(hour=PINNED_HOUR_UTC))
    print(f"Backend data clock pinned to {pinned_start} UTC")
    with freeze_time(pinned_start, tick=True, ignore=REAL_CLOCK_MODULES):
        uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
