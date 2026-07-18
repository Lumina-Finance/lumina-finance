"""Seed a local Firefly III instance with deterministic demo data

Source fixture generator for developing and verifying the Firefly III
importer. Registers the seed user on a freshly reset instance, mints an API
token through a Passport personal access client created inside the container,
sets CAD as the primary currency, then seeds accounts, budgets whose limit
periods cover every shape the importer has to face, and a fixed set of
transactions. Every run produces identical data because all dates are
constants and all randomness flows from one seeded generator

The data follows one persona across five and a half years: a salaried renter
in Toronto who works from home through the pandemic, returns to an office,
buys a car, moves apartments, changes jobs, and travels once borders reopen.
Which transactions a month holds depends on where in that arc it falls, and
amounts carry Canadian consumer price inflation, so both spending and income
shift over the window instead of holding flat

Alongside the data it writes a manifest JSON of expected values (per-account
balances, journal counts, budget parameters, category links) so the data can
be cross-verified after export and import into Lumina Finance

Run through the wrapper script, which resets the Docker instance first:
    dev/firefly-iii/seed-firefly-iii.sh
"""

import http.cookiejar
import json
import os
import random
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import NamedTuple

FIREFLY_URL = os.environ.get("FIREFLY_URL", "http://localhost:8080")
FIREFLY_CONTAINER = os.environ.get("FIREFLY_CONTAINER", "firefly-iii")
MANIFEST_PATH = Path(__file__).with_name("firefly_seed_manifest.json")

SEED_EMAIL = "test@example.com"
SEED_PASSWORD = "passwordpassword"  # noqa: S105

RNG_SEED = 42
START_DATE = date(2021, 1, 1)
END_DATE = date(2026, 7, 15)

# Dates the persona's circumstances change, which gate whole classes of
# transaction rather than only shifting an amount
RETURN_TO_OFFICE_DATE = date(2022, 4, 1)
CAR_PURCHASE_DATE = date(2022, 7, 15)
APARTMENT_MOVE_DATE = date(2023, 8, 1)
PET_ADOPTION_DATE = date(2024, 3, 1)

# Days the persona starts running an envelope for spending that already
# existed, which gate when transactions begin carrying these budgets. The
# fitness budget starts on the first Monday of 2023 because its limit periods
# run Monday to Sunday, and the US shopping envelope was created mid-month so
# its first limit period is a partial month
ELECTRONICS_BUDGET_START = date(2023, 1, 1)
FITNESS_BUDGET_START = date(2023, 1, 2)
CHARITABLE_BUDGET_START = date(2022, 1, 1)
US_SHOPPING_BUDGET_START = date(2024, 5, 21)
ALLOWANCE_BUDGET_START = date(2025, 3, 1)

# Monthly net pay in CAD after Ontario tax, CPP, and EI, stepping on merit
# raises and once on the September 2023 job change. Real net pay climbs late in
# the year as CPP and EI reach their ceilings, which a fixture cannot model
# without a payroll engine, so the bonus and refund below carry the
# within-year variation instead
SALARY_SCHEDULE = [
    (date(2021, 1, 1), "4780.00"),
    (date(2021, 4, 1), "4910.00"),
    (date(2022, 4, 1), "5060.00"),
    (date(2023, 4, 1), "5210.00"),
    (date(2023, 9, 1), "5890.00"),
    (date(2024, 4, 1), "6040.00"),
    (date(2025, 4, 1), "6250.00"),
    (date(2026, 4, 1), "6450.00"),
]

# Performance bonus paid each March, growing with seniority and the new job
ANNUAL_BONUS = {
    2021: "1800.00",
    2022: "2500.00",
    2023: "2900.00",
    2024: "3500.00",
    2025: "4000.00",
    2026: "4200.00",
}

# Tax refund landing in the spring, varying with the year's deductions
TAX_REFUND = {
    2021: ("2021-05-07", "1240.00"),
    2022: ("2022-05-06", "860.00"),
    2023: ("2023-05-12", "1580.00"),
    2024: ("2024-05-10", "690.00"),
    2025: ("2025-05-09", "1425.00"),
    2026: ("2026-05-08", "1120.00"),
}

# Rent follows Ontario's annual guideline increase on the lease anniversary,
# with the 2023 move to a larger apartment as the one step change. The
# province froze the guideline at zero for 2021, so the first raise is 2022
RENT_SCHEDULE = [
    (date(2021, 1, 1), "1850.00"),
    (date(2022, 1, 1), "1872.00"),
    (date(2023, 1, 1), "1919.00"),
    (APARTMENT_MOVE_DATE, "2350.00"),
    (date(2024, 8, 1), "2409.00"),
    (date(2025, 8, 1), "2469.00"),
]

INTERNET_SCHEDULE = [
    (date(2021, 1, 1), "69.99"),
    (date(2023, 3, 1), "79.99"),
    (date(2025, 2, 1), "89.99"),
]

PHONE_SCHEDULE = [
    (date(2021, 1, 1), "55.00"),
    (date(2023, 6, 1), "60.00"),
    (date(2025, 3, 1), "64.50"),
]

STREAMING_SCHEDULE = [
    (date(2021, 1, 1), "12.99"),
    (date(2022, 6, 1), "14.49"),
    (date(2023, 10, 1), "16.49"),
    (date(2025, 1, 1), "18.99"),
]

MUSIC_STREAMING_SCHEDULE = [
    (date(2021, 1, 1), "9.99"),
    (date(2023, 8, 1), "10.99"),
    (date(2025, 5, 1), "11.99"),
]

# A second video service picked up once there was something on it worth
# watching, which is the shape most streaming households ended up in
SECOND_STREAMING_SCHEDULE = [
    (date(2022, 2, 1), "11.99"),
    (date(2023, 12, 1), "13.99"),
    (date(2025, 6, 1), "15.99"),
]

CLOUD_STORAGE_SCHEDULE = [
    (date(2021, 1, 1), "2.99"),
    (date(2024, 3, 1), "3.99"),
]

GYM_SCHEDULE = [
    (date(2021, 1, 1), "44.00"),
    (date(2022, 9, 1), "49.00"),
    (date(2024, 5, 1), "54.00"),
    (date(2026, 1, 1), "59.00"),
]

# Tenant insurance runs the whole window, car insurance only once there is a
# car. Toronto premiums are the highest in the country, which the amounts show
TENANT_INSURANCE_SCHEDULE = [
    (date(2021, 1, 1), "26.00"),
    (date(2023, 8, 1), "31.00"),
    (date(2025, 4, 1), "34.00"),
]

CAR_INSURANCE_SCHEDULE = [
    (CAR_PURCHASE_DATE, "185.00"),
    (date(2023, 7, 1), "198.00"),
    (date(2024, 7, 1), "210.00"),
    (date(2025, 7, 1), "219.00"),
]

CAR_LOAN_PRINCIPAL = "22000.00"
CAR_LOAN_PAYMENT = "425.00"

# Purchases at or above this are never paid in cash, which keeps the wallet
# spending in line with what the ATM withdrawals put in it
CASH_PURCHASE_CEILING = 30

# What the persona likes to still have in the wallet after a month of spending,
# which decides when the next ATM withdrawal happens
CASH_WALLET_FLOAT = 150

# Cash is withdrawn within this many days of the start of the month, so the
# wallet is funded before the month spends it rather than part way through
CASH_WITHDRAWAL_WINDOW_DAYS = 6

# Cumulative Canadian consumer price index against 2021, which scales the
# discretionary amount bands. Groceries ran well ahead of the headline rate
# through 2022 and 2023, so they carry their own curve
CPI_INDEX = {2021: 1.000, 2022: 1.068, 2023: 1.110, 2024: 1.136, 2025: 1.159, 2026: 1.180}
GROCERY_CPI_INDEX = {2021: 1.000, 2022: 1.098, 2023: 1.163, 2024: 1.190, 2025: 1.214, 2026: 1.235}

# CAD per one unit of foreign currency, by year, with noise added per
# transaction. EUR is only carried for the year of the Europe trip, so a trip
# moved to another year fails loudly rather than inventing a rate
CAD_PER_FOREIGN_UNIT = {
    "USD": {2021: 1.254, 2022: 1.302, 2023: 1.350, 2024: 1.370, 2025: 1.405, 2026: 1.395},
    "EUR": {2024: 1.505},
}

# Annual savings interest rate tracking the Bank of Canada's path, near zero
# through the pandemic, peaking with the 2023 hikes, then easing
SAVINGS_INTEREST_RATE = {2021: 0.005, 2022: 0.019, 2023: 0.040, 2024: 0.043, 2025: 0.028, 2026: 0.025}

# Balances the quarterly interest deposits are computed against, which avoids
# replaying every transaction to know what the accounts held at the time
SAVINGS_INTEREST_BASE_CAD = 16000
SAVINGS_INTEREST_BASE_USD = 2400

class SpendingPattern(NamedTuple):
    """One kind of everyday purchase and the window it is part of the persona's life

    How often the purchase happens is expressed per month rather than as a
    share of a monthly total, so what a category costs stays tied to its
    budget. The same merchant can appear twice with different windows to model
    a habit that fades or takes hold
    """

    merchant: str
    description: str
    category: str
    budget: str | None
    low: float
    high: float
    per_month: float
    active_from: date = START_DATE
    active_until: date = END_DATE


# Everyday spending, gated by the persona's arc. The pandemic year leans on
# groceries, delivery, and home office kit, and dining, commuting, and outings
# only take over once there is an office to go back to
EVERYDAY_SPENDING = [
    SpendingPattern("Neighbourhood Grocer", "Weekly groceries", "Groceries", "Groceries", 30, 80, 6.0),
    SpendingPattern("Corner Market", "Grocery top-up", "Groceries", "Groceries", 5, 22, 5.0),
    SpendingPattern("Convenience Store", "Snacks", "Groceries", "Groceries", 3, 12, 3.0),
    SpendingPattern("Grocery Delivery Service", "Grocery delivery", "Groceries", "Groceries",
                    50, 110, 1.0, active_until=date(2022, 6, 30)),
    SpendingPattern("Liquor Store", "Wine and beer", "Alcohol", None, 18, 50, 2.5),
    SpendingPattern("Takeout Kitchen", "Takeout dinner", "Dining", "Dining Out",
                    20, 52, 2.5, active_until=date(2022, 6, 30)),
    SpendingPattern("Meal Delivery App", "Food delivery", "Dining", "Dining Out",
                    26, 55, 2.0, active_until=RETURN_TO_OFFICE_DATE - timedelta(days=1)),
    SpendingPattern("Meal Delivery App", "Food delivery", "Dining", "Dining Out",
                    26, 55, 2.0, active_from=RETURN_TO_OFFICE_DATE),
    SpendingPattern("Local Coffee Shop", "Coffee", "Dining", "Dining Out",
                    3, 8, 3.0, active_until=RETURN_TO_OFFICE_DATE - timedelta(days=1)),
    SpendingPattern("Local Coffee Shop", "Coffee", "Dining", "Dining Out",
                    3, 8, 17.0, active_from=RETURN_TO_OFFICE_DATE),
    SpendingPattern("Quick Lunch Counter", "Lunch", "Dining", "Dining Out",
                    10, 20, 0.8, active_until=RETURN_TO_OFFICE_DATE - timedelta(days=1)),
    SpendingPattern("Quick Lunch Counter", "Lunch", "Dining", "Dining Out",
                    10, 20, 7.0, active_from=RETURN_TO_OFFICE_DATE),
    SpendingPattern("Downtown Bistro", "Dinner out", "Dining", "Dining Out",
                    32, 110, 0.6, active_until=RETURN_TO_OFFICE_DATE - timedelta(days=1)),
    SpendingPattern("Downtown Bistro", "Dinner out", "Dining", "Dining Out",
                    32, 110, 1.5, active_from=RETURN_TO_OFFICE_DATE),
    SpendingPattern("Transit Authority", "Transit fare", "Transportation", "Transportation",
                    3, 12, 12.0, active_until=CAR_PURCHASE_DATE - timedelta(days=1)),
    SpendingPattern("Transit Authority", "Transit fare", "Transportation", "Transportation",
                    3, 12, 2.0, active_from=CAR_PURCHASE_DATE),
    SpendingPattern("Rideshare", "Rideshare trip", "Transportation", "Transportation",
                    12, 32, 1.0, active_until=RETURN_TO_OFFICE_DATE - timedelta(days=1)),
    SpendingPattern("Rideshare", "Rideshare trip", "Transportation", "Transportation",
                    12, 32, 2.5, active_from=RETURN_TO_OFFICE_DATE),
    SpendingPattern("Gas Station", "Gas fill-up", "Transportation", "Transportation",
                    40, 90, 3.2, active_from=CAR_PURCHASE_DATE),
    SpendingPattern("Parking Garage", "Parking", "Transportation", "Transportation",
                    5, 22, 4.0, active_from=CAR_PURCHASE_DATE),
    SpendingPattern("Auto Service Centre", "Car maintenance", "Transportation", "Transportation",
                    90, 420, 0.25, active_from=CAR_PURCHASE_DATE),
    SpendingPattern("Pharmacy", "Pharmacy purchase", "Health", None, 6, 40, 2.0),
    SpendingPattern("Dental Clinic", "Dental visit", "Health", None, 120, 340, 0.17),
    SpendingPattern("Cinema", "Movie night", "Entertainment", "Entertainment",
                    12, 42, 0.3, active_until=RETURN_TO_OFFICE_DATE - timedelta(days=1)),
    SpendingPattern("Cinema", "Movie night", "Entertainment", "Entertainment",
                    12, 42, 1.2, active_from=RETURN_TO_OFFICE_DATE),
    SpendingPattern("Bookstore", "Books", "Entertainment", "Entertainment", 12, 50, 1.0),
    SpendingPattern("Concert Venue", "Concert ticket", "Entertainment", "Entertainment",
                    40, 130, 0.4, active_from=date(2022, 6, 1)),
    SpendingPattern("Home Office Supplier", "Home office equipment", "Home Office", "Home Office",
                    40, 320, 1.2, active_until=date(2021, 12, 31)),
    SpendingPattern("Clothing Boutique", "Clothing", "Clothing", "Clothing", 25, 120, 1.2),

    # Electronics purchases only start carrying their budget once the persona
    # creates it at the start of 2023, so the same habit spans both windows
    SpendingPattern("Electronics Store", "Electronics", "Shopping", None,
                    40, 400, 0.25, active_until=ELECTRONICS_BUDGET_START - timedelta(days=1)),
    SpendingPattern("Electronics Store", "Electronics", "Shopping", "Electronics",
                    40, 400, 0.25, active_from=ELECTRONICS_BUDGET_START),
    SpendingPattern("Climbing Gym", "Climbing drop-in", "Fitness", "Fitness",
                    22, 34, 2.6, active_from=FITNESS_BUDGET_START),
    SpendingPattern("Community Food Bank", "Charitable donation", "Donations", "Charitable Giving",
                    35, 140, 0.4, active_from=CHARITABLE_BUDGET_START),

    # Furnishing the new apartment is a short burst of purchases the persona
    # ran a dedicated envelope for, then archived once the place was set up
    SpendingPattern("Downtown Furniture Store", "Furniture for the new apartment", "Household",
                    "Apartment Furnishing", 80, 480, 2.5,
                    active_from=APARTMENT_MOVE_DATE, active_until=date(2023, 9, 30)),
    SpendingPattern("Hobby Shop", "Hobby supplies", "Hobbies", "Personal Allowance",
                    12, 45, 2.0, active_from=ALLOWANCE_BUDGET_START),
    SpendingPattern("Hardware Store", "Home repair supplies", "Household", "Household", 10, 85, 0.9),
    SpendingPattern("Pet Supply Shop", "Pet food and supplies", "Pet", "Household",
                    18, 65, 2.2, active_from=PET_ADOPTION_DATE),
    SpendingPattern("Veterinary Clinic", "Vet visit", "Pet", "Household",
                    90, 320, 0.15, active_from=PET_ADOPTION_DATE),
]

# Scales how much everyday spending a month holds, peaking over the holidays
# and through the summer and thinnest in the quiet weeks after New Year
SEASONAL_SPENDING_FACTOR = {
    1: 0.88, 2: 0.90, 3: 0.96, 4: 1.00, 5: 1.05, 6: 1.08,
    7: 1.10, 8: 1.06, 9: 1.00, 10: 0.98, 11: 1.05, 12: 1.28,
}


class Trip(NamedTuple):
    """One holiday, and the currency spent once the persona is on the ground"""

    depart: date
    nights: int
    label: str
    currency: str
    flight_low: float
    flight_high: float
    daily_low: float
    daily_high: float


# Travel stops for the pandemic and resumes in 2022. US trips spend a mix of
# the US dollar savings and the Canadian credit card, and the Europe trip puts
# euro amounts on that same Canadian card
TRIPS = [
    Trip(date(2022, 5, 20), 4, "US city break", "USD", 380, 520, 90, 260),
    Trip(date(2023, 2, 17), 5, "US winter escape", "USD", 420, 610, 95, 280),
    Trip(date(2023, 7, 21), 6, "US road trip", "USD", 340, 480, 80, 240),
    Trip(date(2024, 9, 12), 9, "Europe holiday", "EUR", 890, 1180, 70, 210),
    Trip(date(2025, 6, 19), 5, "US city break", "USD", 450, 640, 100, 300),
    Trip(date(2026, 5, 14), 4, "US city break", "USD", 470, 660, 105, 310),
]

rng = random.Random(RNG_SEED)

cookie_jar = http.cookiejar.CookieJar()
session_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))

api_token = ""


def http_request(opener, url: str, method: str = "GET", data: bytes | None = None,
                 headers: dict | None = None) -> tuple[int, str]:
    """Send an HTTP request through the given opener and return status and body"""
    req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
    try:
        with opener.open(req) as resp:
            return resp.status, resp.read().decode(errors="replace")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode(errors="replace")


def api(method: str, path: str, payload: dict | None = None) -> tuple[int, dict]:
    """Call the Firefly III API with the bearer token and return status and JSON"""
    status, body = http_request(
        urllib.request.build_opener(),
        f"{FIREFLY_URL}/api/v1{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        return status, json.loads(body or "{}")
    except json.JSONDecodeError:
        return status, {"raw": body}


def register_seed_user() -> None:
    """Register the seed user, aborting when the instance is not fresh"""
    status, body = http_request(session_opener, f"{FIREFLY_URL}/register")
    if status != 200:
        sys.exit("Registration page unavailable, reset the instance before seeding")

    token_match = re.search(r'name="_token" value="([^"]+)"', body)
    if not token_match:
        sys.exit("Could not find the CSRF token on the registration page")

    form = urllib.parse.urlencode({
        "_token": token_match.group(1),
        "email": SEED_EMAIL,
        "password": SEED_PASSWORD,
        "password_confirmation": SEED_PASSWORD,
    }).encode()
    status, body = http_request(
        session_opener, f"{FIREFLY_URL}/register", method="POST", data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    # Laravel answers registration with a redirect, and landing anywhere other
    # than home means validation rejected the seed user
    if "/home" not in body and status not in (200, 302):
        sys.exit(f"Registration failed with status {status}")
    print(f"registered {SEED_EMAIL}")


def mint_api_token() -> str:
    """Create a Passport client in the container and mint a personal access token"""
    subprocess.run(
        ["docker", "exec", FIREFLY_CONTAINER, "php", "artisan", "passport:client",
         "--personal", "--name", "seeder", "--no-interaction"],
        check=True, capture_output=True,
    )

    status, body = http_request(session_opener, f"{FIREFLY_URL}/profile")
    csrf_match = re.search(r'name="csrf-token" content="([^"]+)"', body)
    if status != 200 or not csrf_match:
        sys.exit("Could not load a CSRF token for the token mint request")

    status, body = http_request(
        session_opener, f"{FIREFLY_URL}/oauth/personal-access-tokens", method="POST",
        data=json.dumps({"name": "seeder", "scopes": []}).encode(),
        headers={
            "X-CSRF-TOKEN": csrf_match.group(1),
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/json",
        },
    )
    if status != 200:
        sys.exit(f"Minting the access token failed with status {status}: {body[:300]}")
    return json.loads(body)["accessToken"]


def configure_currencies() -> None:
    """Enable the seeded currencies and make CAD the primary one"""
    for path in ["/currencies/CAD/enable", "/currencies/USD/enable", "/currencies/EUR/enable",
                 "/currencies/CAD/primary"]:
        status, body = api("POST", path, {})
        if status != 200:
            sys.exit(f"Currency setup failed on {path}: {status} {body}")
    print("currencies configured, CAD primary")


def build_month_starts() -> list[date]:
    """Return the first day of every month in the seeded range"""
    months = []
    current = START_DATE.replace(day=1)
    while current <= END_DATE:
        months.append(current)
        current = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
    return months


def month_end(first_of_month: date) -> date:
    """Return the last day of the month containing the given date"""
    return (first_of_month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


MONTH_STARTS = build_month_starts()


def scheduled_value(schedule: list[tuple[date, str]], day: date) -> str | None:
    """Return the amount in force on a day, or None before the schedule starts

    Args:
        schedule: Effective-from dates paired with amounts, in ascending order
        day: Day to read the schedule on

    Returns:
        Amount from the latest entry that has taken effect, or None when the
        day falls before every entry
    """
    applicable = [amount for effective_from, amount in schedule if effective_from <= day]
    return applicable[-1] if applicable else None


def day_in_month(month_start: date, day_of_month: int) -> date | None:
    """Return a day of the month clamped into the seeded range, or None outside it"""
    target = month_start.replace(day=min(day_of_month, 28))
    return target if START_DATE <= target <= END_DATE else None


def last_business_day(month_start: date) -> date | None:
    """Return the last weekday of the month, or None when it falls past the range

    Pay lands at the end of the month, so a month the range cuts short has not
    been paid yet and clamping the date would invent income the persona has
    not received
    """
    day = month_end(month_start)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    return day if day <= END_DATE else None


def random_day_in(month_start: date) -> date:
    """Return a uniformly chosen day inside the month, clamped to the range"""
    last = min(month_end(month_start), END_DATE)
    return month_start + timedelta(days=rng.randrange((last - month_start).days + 1))


def money(low: float, high: float) -> str:
    """Return an amount drawn uniformly from a band, to the cent"""
    return f"{rng.uniform(low, high):.2f}"


def inflated_money(low: float, high: float, day: date, index: dict[int, float] = CPI_INDEX) -> str:
    """Return an amount from a 2021 band carried forward to the day's price level"""
    factor = index[day.year]
    return money(low * factor, high * factor)


def cad_per_unit(currency: str, day: date) -> float:
    """Return CAD per one unit of a foreign currency, with per-transaction noise"""
    return CAD_PER_FOREIGN_UNIT[currency][day.year] * rng.uniform(0.985, 1.015)


def add_months(month_start: date, months: int) -> date:
    """Return the first of the month a number of months later"""
    total = month_start.year * 12 + month_start.month - 1 + months
    return date(total // 12, total % 12 + 1, 1)


def month_limit_rows(first: date, months_per_period: int, schedule: list[tuple[date, str]],
                     currency: str = "CAD", last: date | None = None) -> list[dict]:
    """Build consecutive calendar-month limit rows carrying the scheduled amount

    Args:
        first: First day of the first period, always the first of a month
        months_per_period: Calendar months each limit period spans
        schedule: Effective-from dates paired with amounts
        currency: Currency code the limits are set in
        last: First day of the final period, or None to run to the range end

    Returns:
        Limit rows as start, end, amount, and currency
    """
    rows = []
    start = first
    while start <= (last or END_DATE):
        following = add_months(start, months_per_period)
        rows.append({"start": start, "end": following - timedelta(days=1),
                     "amount": scheduled_value(schedule, start), "currency": currency})
        start = following
    return rows


def fixed_length_limit_rows(first: date, length_days: int,
                            schedule: list[tuple[date, str]]) -> list[dict]:
    """Build back-to-back limit rows of a fixed day length until the range end"""
    rows = []
    start = first
    while start <= END_DATE:
        rows.append({"start": start, "end": start + timedelta(days=length_days - 1),
                     "amount": scheduled_value(schedule, start), "currency": "CAD"})
        start += timedelta(days=length_days)
    return rows


def imported_as(freq: str, *, length: int = 1, weekday: int | None = None,
                dom: int | None = None, month: int | None = None, recurs: bool = True,
                archived: bool = False) -> dict:
    """Describe the Lumina cadence an imported budget is expected to carry"""
    return {"outcome": "imported", "is_archived": archived, "cadence": {
        "recurrence_freq": freq, "instance_length": length, "recurrence_weekday": weekday,
        "recurrence_dom": dom, "recurrence_month": month, "recurs": recurs,
    }}


def skipped_as(reason: str) -> dict:
    """Describe a budget the import flow is expected to skip and the reason code"""
    return {"outcome": "skipped", "reason": reason}


# The Europe holiday gets a dedicated one-off envelope opening just before the
# flight is booked and closing a few days after the return, so its window fits
# no calendar cadence on purpose
EUROPE_TRIP = next(trip for trip in TRIPS if trip.currency == "EUR")
EUROPE_TRIP_WINDOW = (
    EUROPE_TRIP.depart - timedelta(days=27),
    EUROPE_TRIP.depart + timedelta(days=EUROPE_TRIP.nights + 3),
)

# Travel only carries a limit in the months a trip departs, because the
# persona sets trip money aside per trip rather than every month. The Europe
# holiday runs its own envelope, so its month carries no Travel limit
TRAVEL_LIMIT_MONTHS = [trip.depart.replace(day=1) for trip in TRIPS if trip.currency != "EUR"]
TRAVEL_LIMIT_SCHEDULE = [
    (date(2022, 1, 1), "1800.00"), (date(2023, 1, 1), "2000.00"), (date(2025, 1, 1), "2200.00"),
]

# One budget per limit period shape the importer has to face. Every amount
# schedule steps at least once because Firefly III stores an amount per limit
# period, so a flat schedule would hide an importer keeping only the latest
# amount, and the amounts track what the persona's spending actually costs so
# each budget lands within reach of its limit
#
# The expected import outcome rides along for the verify tooling: budgets
# whose latest period fits a Lumina cadence import with that cadence, a lone
# irregular window imports as a one-off, archived budgets import as archived
# base budgets, and transaction-less, mixed-currency, and oddly recurring
# budgets are skipped with a reason code
BUDGET_DEFINITIONS = {

    # Groceries carried transactions for a month before its first limit, so
    # January 2021 spending predates the limit history
    "Groceries": {
        "active": True,
        "limits": month_limit_rows(date(2021, 2, 1), 1, [
            (date(2021, 1, 1), "520.00"), (date(2022, 1, 1), "560.00"),
            (date(2023, 1, 1), "585.00"), (date(2024, 1, 1), "620.00"),
            (date(2025, 1, 1), "640.00"), (date(2026, 1, 1), "665.00"),
        ]),
        "import": imported_as("monthly", dom=1),
    },
    "Dining Out": {
        "active": True,
        "limits": month_limit_rows(date(2021, 1, 1), 1, [
            (date(2021, 1, 1), "260.00"), (RETURN_TO_OFFICE_DATE, "420.00"),
            (date(2024, 1, 1), "470.00"), (date(2025, 1, 1), "490.00"),
        ]),
        "import": imported_as("monthly", dom=1),
    },

    # Transportation covers the car insurance premium as well as fuel and
    # parking, which is why it steps so hard at the car purchase
    "Transportation": {
        "active": True,
        "limits": month_limit_rows(date(2021, 1, 1), 1, [
            (date(2021, 1, 1), "110.00"), (date(2022, 7, 1), "560.00"),
            (date(2024, 1, 1), "600.00"), (date(2025, 1, 1), "640.00"),
        ]),
        "import": imported_as("monthly", dom=1),
    },

    # Entertainment switches from monthly to quarterly limits in 2024, so the
    # cadence read off the latest period differs from the earlier history
    "Entertainment": {
        "active": True,
        "limits": month_limit_rows(date(2021, 1, 1), 1, [
            (date(2021, 1, 1), "60.00"), (RETURN_TO_OFFICE_DATE, "100.00"),
            (date(2023, 1, 1), "140.00"),
        ], last=date(2023, 12, 1)) + month_limit_rows(date(2024, 1, 1), 3, [
            (date(2024, 1, 1), "420.00"), (date(2025, 1, 1), "480.00"),
        ]),
        "import": imported_as("monthly", length=3, dom=1),
    },

    # Household covers the utility bills as well as repairs and the pet, which
    # is why it sits high and steps at the adoption
    "Household": {
        "active": True,
        "limits": month_limit_rows(date(2021, 1, 1), 1, [
            (date(2021, 1, 1), "310.00"), (date(2022, 1, 1), "330.00"),
            (date(2023, 1, 1), "350.00"), (PET_ADOPTION_DATE, "480.00"),
            (date(2025, 1, 1), "510.00"), (date(2026, 1, 1), "540.00"),
        ]),
        "import": imported_as("monthly", dom=1),
    },
    "Travel": {
        "active": True,
        "limits": [
            {"start": month, "end": month_end(month),
             "amount": scheduled_value(TRAVEL_LIMIT_SCHEDULE, month), "currency": "CAD"}
            for month in TRAVEL_LIMIT_MONTHS
        ],
        "import": imported_as("monthly", dom=1),
    },
    "Clothing": {
        "active": True,
        "limits": month_limit_rows(date(2022, 1, 1), 6, [
            (date(2022, 1, 1), "560.00"), (date(2023, 1, 1), "590.00"),
            (date(2024, 1, 1), "610.00"), (date(2025, 1, 1), "630.00"),
            (date(2026, 1, 1), "650.00"),
        ]),
        "import": imported_as("monthly", length=6, dom=1),
    },

    # A New Year's resolution budget running Monday to Sunday, which is the
    # only weekly limit history in the fixture
    "Fitness": {
        "active": True,
        "limits": fixed_length_limit_rows(FITNESS_BUDGET_START, 7, [
            (date(2023, 1, 1), "40.00"), (date(2024, 1, 1), "44.00"),
            (date(2025, 1, 1), "48.00"), (date(2026, 1, 1), "50.00"),
        ]),
        "import": imported_as("weekly", weekday=0),
    },
    "Charitable Giving": {
        "active": True,
        "limits": month_limit_rows(CHARITABLE_BUDGET_START, 12, [
            (date(2022, 1, 1), "500.00"), (date(2023, 1, 1), "520.00"),
            (date(2024, 1, 1), "540.00"), (date(2025, 1, 1), "560.00"),
            (date(2026, 1, 1), "580.00"),
        ]),
        "import": imported_as("yearly", month=1, dom=1),
    },

    # Created mid-month, so the first limit period is a partial month before
    # the history settles into whole months, and the only budget whose limits
    # are set in US dollars throughout
    "US Shopping": {
        "active": True,
        "limits": [{"start": US_SHOPPING_BUDGET_START,
                    "end": month_end(US_SHOPPING_BUDGET_START),
                    "amount": "60.00", "currency": "USD"}]
        + month_limit_rows(date(2024, 6, 1), 1, [
            (date(2024, 6, 1), "160.00"), (date(2025, 1, 1), "170.00"),
            (date(2026, 1, 1), "175.00"),
        ], currency="USD"),
        "import": imported_as("monthly", dom=1),
    },

    # A lone irregular window is a one-off envelope, which imports without a
    # matching cadence and without recurring
    "Europe Trip": {
        "active": True,
        "limits": [{"start": EUROPE_TRIP_WINDOW[0], "end": EUROPE_TRIP_WINDOW[1],
                    "amount": "3500.00", "currency": "CAD"}],
        "import": imported_as("monthly", dom=1, recurs=False),
    },

    # Its limits are whole calendar months anchored on day 1, so the cadence
    # reads monthly dom 1 with recurs True
    "Home Office": {
        "active": False,
        "limits": month_limit_rows(date(2021, 1, 1), 1, [(date(2021, 1, 1), "280.00")],
                                   last=date(2021, 12, 1)),
        "import": imported_as("monthly", dom=1, archived=True),
    },

    # Its one limit window spans two whole calendar months anchored on day 1,
    # so the cadence reads monthly with length 2 and recurs True even though
    # the budget arrives archived
    "Apartment Furnishing": {
        "active": False,
        "limits": [{"start": APARTMENT_MOVE_DATE, "end": date(2023, 9, 30),
                    "amount": "1800.00", "currency": "CAD"}],
        "import": imported_as("monthly", length=2, dom=1, archived=True),
    },

    # Created with limits but never assigned a transaction, so there is
    # nothing to infer tracked categories from
    "Gifts": {
        "active": True,
        "limits": month_limit_rows(date(2024, 1, 1), 1, [(date(2024, 1, 1), "50.00")],
                                   last=date(2024, 6, 1)),
        "import": skipped_as("no-transactions"),
    },

    # The limit history switches from CAD to USD in 2025, and a Lumina budget
    # holds one currency
    "Electronics": {
        "active": True,
        "limits": month_limit_rows(ELECTRONICS_BUDGET_START, 1, [
            (date(2023, 1, 1), "90.00"), (date(2024, 1, 1), "100.00"),
        ], last=date(2024, 12, 1)) + month_limit_rows(date(2025, 1, 1), 1, [
            (date(2025, 1, 1), "70.00"),
        ], currency="USD"),
        "import": skipped_as("mixed-currencies"),
    },

    # A self-imposed rolling allowance reset every 13 days, which deliberately
    # trades realism for a recurring period no Lumina cadence can express
    "Personal Allowance": {
        "active": True,
        "limits": fixed_length_limit_rows(ALLOWANCE_BUDGET_START, 13, [
            (date(2025, 3, 1), "45.00"), (date(2026, 1, 1), "50.00"),
        ]),
        "import": skipped_as("unsupported-cadence"),
    },
}


def create_budgets() -> dict[str, int]:
    """Create the budgets with their limit period rows and return their ids"""
    limit_rows = 0
    budget_ids = {}
    for name, definition in BUDGET_DEFINITIONS.items():
        status, body = api("POST", "/budgets", {"name": name})
        if status != 200:
            sys.exit(f"Budget {name} failed: {status} {body}")
        budget_ids[name] = int(body["data"]["id"])

        for row in definition["limits"]:
            status, body = api("POST", f"/budgets/{budget_ids[name]}/limits", {
                "start": row["start"].isoformat(),
                "end": row["end"].isoformat(),
                "amount": row["amount"],
                "currency_code": row["currency"],
            })
            if status != 200:
                sys.exit(f"Budget limit {name} {row['start']}: {status} {body}")
            limit_rows += 1
    print(f"created {len(budget_ids)} budgets with {limit_rows} limit periods")
    return budget_ids


def archive_inactive_budgets(budget_ids: dict[str, int]) -> None:
    """Archive the budgets the persona retired

    Archiving runs after the transactions are posted because Firefly III should
    see the retired budgets in the state they were used in, and attaching rows
    to an already archived budget is not a path worth depending on
    """
    for name, definition in BUDGET_DEFINITIONS.items():
        if definition["active"]:
            continue
        status, body = api("PUT", f"/budgets/{budget_ids[name]}", {"name": name, "active": False})
        if status != 200:
            sys.exit(f"Archiving budget {name} failed: {status} {body}")
        print(f"archived budget {name}")


def create_accounts() -> dict[str, dict]:
    """Create the asset and liability accounts and return name to id and currency"""
    definitions = [
        {"name": "Everyday Chequing", "type": "asset", "account_role": "defaultAsset",
         "currency_code": "CAD", "account_number": "003-91234-5678901",
         "opening_balance": "4800.00", "opening_balance_date": "2020-12-31"},
        {"name": "High Interest Savings", "type": "asset", "account_role": "savingAsset",
         "currency_code": "CAD", "opening_balance": "11500.00",
         "opening_balance_date": "2020-12-31"},
        {"name": "Cash Wallet", "type": "asset", "account_role": "cashWalletAsset",
         "currency_code": "CAD"},
        {"name": "Rewards Credit Card", "type": "asset", "account_role": "ccAsset",
         "currency_code": "CAD", "credit_card_type": "monthlyFull",
         "monthly_payment_date": "2021-01-18"},
        {"name": "US Dollar Savings", "type": "asset", "account_role": "savingAsset",
         "currency_code": "USD", "opening_balance": "1800.00",
         "opening_balance_date": "2020-12-31"},

        # The car loan opens partway through the window because the car is
        # bought in 2022, which Firefly III models as an opening balance dated
        # to the purchase
        {"name": "Car Loan", "type": "liabilities", "liability_type": "loan",
         "liability_direction": "debit", "currency_code": "CAD", "interest": "5.9",
         "interest_period": "monthly", "opening_balance": CAR_LOAN_PRINCIPAL,
         "opening_balance_date": CAR_PURCHASE_DATE.isoformat()},
    ]
    accounts = {}
    for definition in definitions:
        status, body = api("POST", "/accounts", definition)
        if status != 200:
            sys.exit(f"Account {definition['name']} failed: {status} {body}")
        accounts[definition["name"]] = {
            "id": int(body["data"]["id"]),
            "currency": definition["currency_code"],
            "type": definition["type"],
            "opening_balance": definition.get("opening_balance", "0"),
        }
    print(f"created {len(accounts)} accounts")
    return accounts


def build_split(txn_type: str, day: date, amount: str, description: str, **fields) -> dict:
    """Build one transaction split payload in API shape"""
    split = {
        "type": txn_type,
        "date": day.isoformat(),
        "amount": amount,
        "description": description,
    }
    split.update({key: value for key, value in fields.items() if value is not None})
    return split


def build_group(*splits: dict, title: str | None = None) -> dict:
    """Build one transaction group payload from its splits"""
    payload = {
        "error_if_duplicate_hash": False,
        "apply_rules": False,
        "fire_webhooks": False,
        "transactions": list(splits),
    }
    if title:
        payload["group_title"] = title
    return payload


def income_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the salary, bonus, and tax refund groups for one month"""
    chequing = accounts["Everyday Chequing"]["id"]
    groups = []

    payday = last_business_day(month)
    if payday is not None:
        groups.append(build_group(build_split(
            "deposit", payday, scheduled_value(SALARY_SCHEDULE, month), "Monthly salary",
            source_name="Employer Payroll", destination_id=chequing,
            category_name="Salary", tags=["payroll"],
        )))

    bonus_day = day_in_month(month, 20)
    if month.month == 3 and bonus_day is not None:
        groups.append(build_group(build_split(
            "deposit", bonus_day, ANNUAL_BONUS[month.year], "Performance bonus",
            source_name="Employer Payroll", destination_id=chequing,
            category_name="Bonus", tags=["payroll"],
        )))

    refund_date, refund_amount = TAX_REFUND[month.year]
    refund_day = date.fromisoformat(refund_date)
    if refund_day.month == month.month and refund_day <= END_DATE:
        groups.append(build_group(build_split(
            "deposit", refund_day, refund_amount, "Income tax refund",
            source_name="Canada Revenue Agency", destination_id=chequing,
            category_name="Government",
        )))
    return groups


def housing_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the rent group for one month"""
    day = day_in_month(month, 1)
    if day is None:
        return []
    return [build_group(build_split(
        "withdrawal", day, scheduled_value(RENT_SCHEDULE, month), "Monthly rent",
        source_id=accounts["Everyday Chequing"]["id"],
        destination_name="Maple Grove Properties", category_name="Housing", tags=["rent"],
    ))]


def utility_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the hydro, internet, and phone groups for one month

    Hydro swings with the season because Toronto winters run the heat and
    summers run the air conditioning, leaving spring and autumn cheapest
    """
    chequing = accounts["Everyday Chequing"]["id"]
    peak_months = {1, 2, 7, 8, 12}
    shoulder_months = {4, 5, 10, 11}
    if month.month in peak_months:
        hydro_low, hydro_high = 110, 165
    elif month.month in shoulder_months:
        hydro_low, hydro_high = 55, 90
    else:
        hydro_low, hydro_high = 80, 125

    groups = []
    for day_of_month, amount, description, merchant, tags in [
        (5, inflated_money(hydro_low, hydro_high, month), "Hydro bill", "Provincial Hydro", None),
        (8, scheduled_value(INTERNET_SCHEDULE, month), "Internet service",
         "Northern Internet Co", ["subscription"]),
        (12, scheduled_value(PHONE_SCHEDULE, month), "Mobile phone plan",
         "Wireless Provider", ["subscription"]),
    ]:
        day = day_in_month(month, day_of_month)
        if day is None:
            continue
        groups.append(build_group(build_split(
            "withdrawal", day, amount, description, source_id=chequing,
            destination_name=merchant, category_name="Utilities", budget_name="Household",
            tags=tags,
        )))
    return groups


def subscription_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the recurring subscription and gym membership groups for one month

    Every subscription rides the credit card and each one raises its price over
    the window, which is what a card statement full of them actually looks like
    """
    card = accounts["Rewards Credit Card"]["id"]
    groups = []

    for day_of_month, schedule, description, merchant, category, budget in [
        (15, STREAMING_SCHEDULE, "Streaming service", "Streaming Service",
         "Entertainment", "Entertainment"),
        (15, SECOND_STREAMING_SCHEDULE, "Second streaming service", "Screening Room Plus",
         "Entertainment", "Entertainment"),
        (7, MUSIC_STREAMING_SCHEDULE, "Music streaming", "Music Streaming Co",
         "Entertainment", "Entertainment"),
        (22, CLOUD_STORAGE_SCHEDULE, "Cloud storage", "Cloud Storage Provider",
         "Utilities", "Household"),
    ]:
        amount = scheduled_value(schedule, month)
        day = day_in_month(month, day_of_month)
        if amount is None or day is None:
            continue
        groups.append(build_group(build_split(
            "withdrawal", day, amount, description, source_id=card,
            destination_name=merchant, category_name=category, budget_name=budget,
            tags=["subscription"],
        )))

    # The membership joins the fitness budget once that envelope exists, so
    # the same bill spans budgeted and unbudgeted months
    gym_day = day_in_month(month, 20)
    if gym_day is not None:
        groups.append(build_group(build_split(
            "withdrawal", gym_day, scheduled_value(GYM_SCHEDULE, month), "Gym membership",
            source_id=accounts["Everyday Chequing"]["id"], destination_name="City Fitness Club",
            category_name="Fitness", tags=["subscription"],
            budget_name="Fitness" if month >= FITNESS_BUDGET_START.replace(day=1) else None,
        )))
    return groups


def insurance_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the tenant and car insurance groups for one month

    Car insurance carries the Transportation budget and tenant insurance
    carries none, so the Insurance category only joins that budget once there
    is a car to insure
    """
    chequing = accounts["Everyday Chequing"]["id"]
    groups = []

    tenant_day = day_in_month(month, 3)
    if tenant_day is not None:
        groups.append(build_group(build_split(
            "withdrawal", tenant_day, scheduled_value(TENANT_INSURANCE_SCHEDULE, month),
            "Tenant insurance", source_id=chequing, destination_name="Shield Insurance Group",
            category_name="Insurance",
        )))

    car_premium = scheduled_value(CAR_INSURANCE_SCHEDULE, month)
    car_day = day_in_month(month, 25)
    if car_premium is not None and car_day is not None and car_day >= CAR_PURCHASE_DATE:
        groups.append(build_group(build_split(
            "withdrawal", car_day, car_premium, "Car insurance premium", source_id=chequing,
            destination_name="National Auto Insurance", category_name="Insurance",
            budget_name="Transportation",
        )))
    return groups


def car_loan_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the car loan payment group for one month

    Paying down a liability is a withdrawal whose destination is the liability
    account, which is how Firefly III models the balance coming off the loan
    """
    day = day_in_month(month, 28)
    if day is None or day <= CAR_PURCHASE_DATE:
        return []
    return [build_group(build_split(
        "withdrawal", day, CAR_LOAN_PAYMENT, "Car loan payment",
        source_id=accounts["Everyday Chequing"]["id"], destination_id=accounts["Car Loan"]["id"],
        tags=["loan"],
    ))]


def transfer_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the savings contribution for one month

    The pandemic year saves the most because there is so little to spend on,
    the contribution drops once life reopens and the car arrives, recovers as
    the pay does, then eases again as the giving, fitness, and hobby spending
    take hold. It pauses for the two months the car purchase and the apartment
    move drain the buffer
    """
    chequing = accounts["Everyday Chequing"]["id"]
    groups = []

    contribution = "450.00" if month < RETURN_TO_OFFICE_DATE else "350.00"
    if month >= date(2024, 1, 1):
        contribution = "400.00"
    if month >= ALLOWANCE_BUDGET_START:
        contribution = "250.00"
    paused = month in (APARTMENT_MOVE_DATE, CAR_PURCHASE_DATE.replace(day=1))
    contribution_day = day_in_month(month, 2)
    if contribution_day is not None and not paused:
        groups.append(build_group(build_split(
            "transfer", contribution_day, contribution, "Automatic savings contribution",
            source_id=chequing, destination_id=accounts["High Interest Savings"]["id"],
        )))

    return groups


def interest_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the quarterly interest deposits on both savings accounts

    Interest is only paid once a quarter has run its course, so a quarter the
    seeded range cuts short pays nothing
    """
    day = month_end(month)
    if month.month not in (3, 6, 9, 12) or day > END_DATE:
        return []

    rate = SAVINGS_INTEREST_RATE[month.year]
    return [
        build_group(build_split(
            "deposit", day, money(SAVINGS_INTEREST_BASE_CAD * rate / 4 * 0.85,
                                  SAVINGS_INTEREST_BASE_CAD * rate / 4 * 1.15),
            "Savings interest", source_name="Bank Interest",
            destination_id=accounts["High Interest Savings"]["id"], category_name="Interest",
        )),
        build_group(build_split(
            "deposit", day, money(SAVINGS_INTEREST_BASE_USD * rate / 4 * 0.85,
                                  SAVINGS_INTEREST_BASE_USD * rate / 4 * 1.15),
            "USD savings interest", source_name="Bank Interest",
            destination_id=accounts["US Dollar Savings"]["id"], category_name="Interest",
        )),
    ]


def cross_border_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the US online purchases and the currency moves for one month

    The Canadian credit card carries the US dollar amount as a foreign amount,
    which is what a cross-border purchase looks like on a CAD card
    """
    groups = []
    for _ in range(rng.randint(1, 2)):
        day = random_day_in(month)
        usd_amount = rng.uniform(12, 140) * CPI_INDEX[day.year]
        groups.append(build_group(build_split(
            "withdrawal", day, f"{usd_amount * cad_per_unit('USD', day):.2f}",
            "Online purchase in USD", source_id=accounts["Rewards Credit Card"]["id"],
            destination_name="US Online Retailer", category_name="Shopping",
            tags=["cross-border"], foreign_currency_code="USD",
            foreign_amount=f"{usd_amount:.2f}",
            budget_name="US Shopping" if day >= US_SHOPPING_BUDGET_START else None,
        )))

    # Topping up US dollar savings costs Canadian dollars, so the transfer is
    # posted in CAD with the US dollars landing as the foreign amount
    if rng.random() < 0.35:
        day = random_day_in(month)
        usd_amount = rng.uniform(200, 700)
        groups.append(build_group(build_split(
            "transfer", day, f"{usd_amount * cad_per_unit('USD', day):.2f}",
            "Move funds to US dollar savings", source_id=accounts["Everyday Chequing"]["id"],
            destination_id=accounts["US Dollar Savings"]["id"], foreign_currency_code="USD",
            foreign_amount=f"{usd_amount:.2f}",
        )))
    return groups


def repatriation_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the occasional move of US dollars back into the chequing account

    The reverse of a top-up, posted in US dollars from the US account with the
    Canadian dollars arriving as the foreign amount
    """
    if month not in (date(2023, 8, 1), date(2025, 11, 1)):
        return []

    day = month.replace(day=6)
    usd_amount = 1500 if month.year == 2023 else 1200
    return [build_group(build_split(
        "transfer", day, f"{usd_amount:.2f}", "Bring US funds home",
        source_id=accounts["US Dollar Savings"]["id"],
        destination_id=accounts["Everyday Chequing"]["id"], foreign_currency_code="CAD",
        foreign_amount=f"{usd_amount * cad_per_unit('USD', day):.2f}",
    ))]


def trip_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the flight and on-the-ground spending for any trip departing this month

    The Europe holiday spends against its own one-off envelope while every
    other trip draws on the Travel budget
    """
    groups = []
    for trip in TRIPS:
        if trip.depart.replace(day=1) != month:
            continue
        trip_budget = "Europe Trip" if trip.currency == "EUR" else "Travel"

        # The flight is booked a few weeks out and always on the Canadian card
        groups.append(build_group(build_split(
            "withdrawal", trip.depart - timedelta(days=24),
            money(trip.flight_low, trip.flight_high), f"Flight booking, {trip.label}",
            source_id=accounts["Rewards Credit Card"]["id"], destination_name="Airline Booking",
            category_name="Travel", budget_name=trip_budget, tags=["travel"],
        )))

        for night in range(trip.nights):
            day = trip.depart + timedelta(days=night)
            foreign_amount = rng.uniform(trip.daily_low, trip.daily_high)
            groups.append(build_group(build_split(
                "withdrawal", day, f"{foreign_amount * cad_per_unit(trip.currency, day):.2f}",
                f"Travel spending, {trip.label}",
                source_id=accounts["Rewards Credit Card"]["id"],
                destination_name="Travel Merchant", category_name="Travel",
                budget_name=trip_budget, tags=["travel"],
                foreign_currency_code=trip.currency, foreign_amount=f"{foreign_amount:.2f}",
            )))

        # US trips draw on the US dollar savings directly, which spends the
        # account's own currency and so carries no foreign amount
        if trip.currency == "USD":
            for night in range(trip.nights):
                groups.append(build_group(build_split(
                    "withdrawal", trip.depart + timedelta(days=night),
                    money(trip.daily_low * 0.6, trip.daily_high * 0.7),
                    f"US hotel and travel, {trip.label}",
                    source_id=accounts["US Dollar Savings"]["id"],
                    destination_name="US Hotel and Travel", category_name="Travel",
                    tags=["travel"],
                )))
    return groups


def warehouse_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the occasional warehouse run, split across groceries and household"""
    if rng.random() >= 0.45:
        return []

    day = random_day_in(month)
    return [build_group(
        build_split("withdrawal", day, inflated_money(60, 165, day, GROCERY_CPI_INDEX),
                    "Groceries portion", source_id=accounts["Rewards Credit Card"]["id"],
                    destination_name="Bulk Warehouse Store", category_name="Groceries",
                    budget_name="Groceries"),
        build_split("withdrawal", day, inflated_money(20, 90, day), "Household portion",
                    source_id=accounts["Rewards Credit Card"]["id"],
                    destination_name="Bulk Warehouse Store", category_name="Household",
                    budget_name="Household"),
        title="Warehouse run",
    )]


def purchase_count(per_month: float, month: date) -> int:
    """Return how many times a pattern repeats in one month

    A pattern that happens less than monthly still has to land some months and
    not others, so the fraction left over after the whole repeats decides one
    extra by chance
    """
    expected = per_month * SEASONAL_SPENDING_FACTOR[month.month]
    whole = int(expected)
    return whole + (1 if rng.random() < expected - whole else 0)


def spending_source(accounts: dict[str, dict], amount: str) -> int:
    """Return the account an everyday purchase is paid from

    Only small purchases are ever paid in cash, which is what keeps the
    wallet's balance tracking what was withdrawn from the ATM instead of
    drifting away from it
    """
    chequing = accounts["Everyday Chequing"]["id"]
    card = accounts["Rewards Credit Card"]["id"]
    if Decimal(amount) < CASH_PURCHASE_CEILING:
        return rng.choices([chequing, card, accounts["Cash Wallet"]["id"]],
                           weights=[16, 44, 40])[0]
    return rng.choices([chequing, card], weights=[35, 65])[0]


def discretionary_groups(accounts: dict[str, dict], month: date) -> list[dict]:
    """Build the everyday purchases for one month from the patterns active then"""
    chequing = accounts["Everyday Chequing"]["id"]
    groups = []

    for pattern in EVERYDAY_SPENDING:
        if not (pattern.active_from <= month <= pattern.active_until):
            continue

        index = GROCERY_CPI_INDEX if pattern.category == "Groceries" else CPI_INDEX
        for _ in range(purchase_count(pattern.per_month, month)):
            day = random_day_in(month)
            amount = inflated_money(pattern.low, pattern.high, day, index)
            source = spending_source(accounts, amount)

            extra = {}

            # Older rows on the chequing account are reconciled, which is what
            # a long-lived Firefly III instance looks like once statements have
            # been matched off against it
            if source == chequing and day < date(2024, 1, 1) and rng.random() < 0.3:
                extra["reconciled"] = True
            if rng.random() < 0.05:
                extra["notes"] = f"Auto-seeded note for {pattern.description.lower()}"

            groups.append(build_group(build_split(
                "withdrawal", day, amount, pattern.description, source_id=source,
                destination_name=pattern.merchant, category_name=pattern.category,
                budget_name=pattern.budget, **extra,
            )))
    return groups


MONTHLY_GROUP_BUILDERS = [
    income_groups,
    housing_groups,
    utility_groups,
    subscription_groups,
    insurance_groups,
    car_loan_groups,
    transfer_groups,
    interest_groups,
    cross_border_groups,
    repatriation_groups,
    trip_groups,
    warehouse_groups,
    discretionary_groups,
]


def amount_charged_to(payloads: list[dict], account_id: int) -> Decimal:
    """Return what a set of groups spent out of one account"""
    return sum(
        (Decimal(split["amount"]) for payload in payloads for split in payload["transactions"]
         if split["type"] == "withdrawal" and split.get("source_id") == account_id),
        Decimal("0"),
    )


def atm_withdrawal_groups(accounts: dict[str, dict], month: date, wallet_balance: Decimal,
                          cash_spent: Decimal) -> list[dict]:
    """Build the ATM withdrawals that fund one month of cash spending

    Cash is withdrawn in the round amounts an ATM dispenses, enough to cover
    what the wallet spends that month and leave a float behind, so the wallet
    is never spent past empty
    """
    chequing = accounts["Everyday Chequing"]["id"]
    groups = []
    balance = wallet_balance
    while balance < cash_spent + CASH_WALLET_FLOAT:
        amount = rng.choice(["40.00", "60.00", "80.00", "100.00"])
        balance += Decimal(amount)
        day = min(month + timedelta(days=rng.randrange(CASH_WITHDRAWAL_WINDOW_DAYS)), END_DATE)
        groups.append(build_group(build_split(
            "transfer", day, amount, "ATM cash withdrawal",
            source_id=chequing, destination_id=accounts["Cash Wallet"]["id"],
        )))
    return groups


def amount_paid_into(payloads: list[dict], account_id: int) -> Decimal:
    """Return what a set of groups moved into one account"""
    return sum(
        (Decimal(split["amount"]) for payload in payloads for split in payload["transactions"]
         if split.get("destination_id") == account_id),
        Decimal("0"),
    )


def credit_card_payment_group(accounts: dict[str, dict], month: date,
                              owed: Decimal) -> dict | None:
    """Build the group that clears last month's credit card balance

    The card is paid in full every month, so the payment is whatever the month
    before charged to it rather than a figure of its own. Nothing is owed in
    the opening month, which leaves no payment to make
    """
    day = day_in_month(month, 18)
    if day is None or owed <= 0:
        return None
    return build_group(build_split(
        "transfer", day, f"{owed:.2f}", "Credit card payment",
        source_id=accounts["Everyday Chequing"]["id"],
        destination_id=accounts["Rewards Credit Card"]["id"],
    ))


def generate_transaction_groups(accounts: dict[str, dict]) -> list[dict]:
    """Generate the deterministic list of transaction group payloads

    Walks the window a month at a time and asks every builder what that month
    holds, so the persona's arc decides the data rather than a target count

    Two balances carry between months because a month cannot decide them on its
    own: what the credit card was charged becomes the next month's payment, and
    what the wallet has left decides how much cash comes out of the ATM
    """
    card_id = accounts["Rewards Credit Card"]["id"]
    wallet_id = accounts["Cash Wallet"]["id"]
    payloads = []
    owed_on_card = Decimal("0")
    wallet_balance = Decimal("0")

    for month in MONTH_STARTS:
        month_payloads = []
        for builder in MONTHLY_GROUP_BUILDERS:
            month_payloads.extend(builder(accounts, month))

        payment = credit_card_payment_group(accounts, month, owed_on_card)
        if payment:
            month_payloads.append(payment)
        owed_on_card = amount_charged_to(month_payloads, card_id)

        cash_spent = amount_charged_to(month_payloads, wallet_id)
        withdrawals = atm_withdrawal_groups(accounts, month, wallet_balance, cash_spent)
        month_payloads.extend(withdrawals)
        wallet_balance += amount_paid_into(withdrawals, wallet_id) - cash_spent

        payloads.extend(month_payloads)
    return payloads


def compute_manifest(accounts: dict[str, dict], payloads: list[dict]) -> dict:
    """Derive expected balances, counts, and budget facts from the payloads"""
    balances = {
        name: Decimal(info["opening_balance"]) * (-1 if info["type"] == "liabilities" else 1)
        for name, info in accounts.items()
    }
    id_to_name = {info["id"]: name for name, info in accounts.items()}
    journal_counts = {"withdrawal": 0, "deposit": 0, "transfer": 0}
    account_journal_counts = {name: 0 for name in accounts}
    foreign_rows = 0
    budget_facts: dict[str, dict] = {
        name: {"categories": {}, "first_date": None, "transaction_count": 0,
               "total_spent": Decimal("0")}
        for name in BUDGET_DEFINITIONS
    }
    categories = set()
    tags = set()

    for payload in payloads:
        for split in payload["transactions"]:
            txn_type = split["type"]
            amount = Decimal(split["amount"])
            journal_counts[txn_type] += 1
            source = id_to_name.get(split.get("source_id"))
            destination = id_to_name.get(split.get("destination_id"))
            categories.update([split["category_name"]] if "category_name" in split else [])
            tags.update(split.get("tags", []))
            if "foreign_amount" in split:
                foreign_rows += 1

            if source:
                account_journal_counts[source] += 1
                if txn_type in ("withdrawal", "transfer"):
                    balances[source] -= amount
            if destination:
                account_journal_counts[destination] += 1
                if txn_type == "deposit":
                    balances[destination] += amount
                elif txn_type in ("withdrawal", "transfer"):

                    # A destination in another currency receives the foreign
                    # amount, which is expressed in the destination currency
                    source_currency = accounts[source]["currency"] if source else None
                    destination_currency = accounts[destination]["currency"]
                    if source_currency != destination_currency and "foreign_amount" in split:
                        balances[destination] += Decimal(split["foreign_amount"])
                    else:
                        balances[destination] += amount

            budget = split.get("budget_name")
            if budget:
                facts = budget_facts[budget]
                facts["transaction_count"] += 1
                facts["total_spent"] += amount
                split_date = date.fromisoformat(split["date"])
                if facts["first_date"] is None or split_date < facts["first_date"]:
                    facts["first_date"] = split_date

                # The earliest date each category appears against the budget
                # is what a category history would have to reconstruct
                category = split.get("category_name")
                joined_at = facts["categories"].get(category)
                if joined_at is None or split_date < joined_at:
                    facts["categories"][category] = split_date

    split_rows = sum(len(payload["transactions"]) for payload in payloads)
    opening_balance_rows = sum(
        1 for info in accounts.values() if Decimal(info["opening_balance"]) != 0
    )
    return {
        "seed_email": SEED_EMAIL,
        "rng_seed": RNG_SEED,
        "date_range": {"start": START_DATE.isoformat(), "end": END_DATE.isoformat()},
        "transaction_groups": len(payloads),
        "journal_rows": split_rows,
        "journal_counts": journal_counts,
        "opening_balance_rows": opening_balance_rows,
        "foreign_amount_rows": foreign_rows,
        "accounts": {
            name: {
                "currency": info["currency"],
                "type": info["type"],
                "opening_balance": info["opening_balance"],
                "expected_balance": str(balances[name]),
                "journal_rows": account_journal_counts[name],
            }
            for name, info in accounts.items()
        },
        "budgets": {
            name: {
                "active": BUDGET_DEFINITIONS[name]["active"],
                "currencies": sorted({row["currency"] for row in BUDGET_DEFINITIONS[name]["limits"]}),

                # One entry per limit period, which is what the export carries
                # and what an importer preserving history has to reproduce
                "limits": [
                    {"start": row["start"].isoformat(), "end": row["end"].isoformat(),
                     "amount": row["amount"], "currency": row["currency"]}
                    for row in BUDGET_DEFINITIONS[name]["limits"]
                ],
                "import": BUDGET_DEFINITIONS[name]["import"],
                "categories": sorted(facts["categories"]),
                "category_first_dates": {
                    category: joined_at.isoformat()
                    for category, joined_at in sorted(facts["categories"].items())
                },

                # A budget no transaction ever references has no first date,
                # which is itself an expected import outcome
                "first_transaction_date":
                    facts["first_date"].isoformat() if facts["first_date"] else None,
                "transaction_count": facts["transaction_count"],
                "total_spent": str(facts["total_spent"]),
            }
            for name, facts in budget_facts.items()
        },
        "categories": sorted(categories),
        "tags": sorted(tags),
    }


def post_transactions(payloads: list[dict]) -> None:
    """Post every transaction group, aborting when failures accumulate

    Posting stays sequential because Firefly III stores to SQLite, which
    serialises writes, so concurrent posts contend on the write lock and
    finish slower than one at a time
    """
    failures = 0
    for index, payload in enumerate(payloads, start=1):
        status, body = api("POST", "/transactions", payload)
        if status != 200:
            failures += 1
            print(f"FAIL #{index}: {status} {json.dumps(body)[:300]}")
            if failures > 20:
                sys.exit("Too many transaction failures, aborting")
        if index % 200 == 0:
            print(f"posted {index}/{len(payloads)}", flush=True)
    if failures:
        sys.exit(f"{failures} transactions failed, the seed is not deterministic")
    print(f"posted all {len(payloads)} transaction groups")


def main() -> None:
    global api_token
    register_seed_user()
    api_token = mint_api_token()
    configure_currencies()
    accounts = create_accounts()
    budget_ids = create_budgets()
    payloads = generate_transaction_groups(accounts)
    manifest = compute_manifest(accounts, payloads)
    post_transactions(payloads)
    archive_inactive_budgets(budget_ids)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"manifest written to {MANIFEST_PATH}")
    print(json.dumps({key: manifest[key] for key in
                      ["transaction_groups", "journal_rows", "journal_counts"]}, indent=2))


if __name__ == "__main__":
    main()
