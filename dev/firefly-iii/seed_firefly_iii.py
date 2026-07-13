"""Seed a local Firefly III instance with deterministic demo data

Source fixture generator for developing and verifying the Firefly III
importer. Registers the seed user on a freshly reset instance, mints an API
token through a Passport personal access client created inside the container,
sets CAD as the primary currency, then seeds accounts, budgets with monthly
limits, and a fixed set of transactions. Every run produces identical data
because all dates are constants and all randomness flows from one seeded
generator

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

FIREFLY_URL = os.environ.get("FIREFLY_URL", "http://localhost:8080")
FIREFLY_CONTAINER = os.environ.get("FIREFLY_CONTAINER", "firefly-iii")
MANIFEST_PATH = Path(__file__).with_name("firefly_seed_manifest.json")

SEED_EMAIL = "test@example.com"
SEED_PASSWORD = "passwordpassword"  # noqa: S105

RNG_SEED = 42
START_DATE = date(2024, 1, 1)
END_DATE = date(2026, 7, 12)
TARGET_TRANSACTION_GROUPS = 2000

# CAD per 1 USD hovers around this rate, noise is added per transaction
USD_CAD_RATE = 1.37

# Monthly budget limit amounts in CAD, one limit row per month per budget
BUDGET_MONTHLY_AMOUNTS = {
    "Groceries": "700.00",
    "Dining Out": "300.00",
    "Transportation": "400.00",
    "Entertainment": "200.00",
    "Household": "350.00",
}

# Merchant, description, category, budget, and amount band for the random
# everyday spending that fills the gap up to the target transaction count
EVERYDAY_SPENDING = [
    ("Neighbourhood Grocer", "Weekly groceries", "Groceries", "Groceries", 30, 190),
    ("Corner Market", "Grocery top-up", "Groceries", "Groceries", 8, 45),
    ("Local Coffee Shop", "Coffee", "Dining", "Dining Out", 3, 9),
    ("Downtown Bistro", "Dinner out", "Dining", "Dining Out", 30, 120),
    ("Quick Lunch Counter", "Lunch", "Dining", "Dining Out", 9, 24),
    ("Gas Station", "Gas fill-up", "Transportation", "Transportation", 40, 95),
    ("Transit Authority", "Transit fare top-up", "Transportation", "Transportation", 20, 60),
    ("Pharmacy", "Pharmacy purchase", "Health", "Household", 8, 60),
    ("Cinema", "Movie night", "Entertainment", "Entertainment", 14, 45),
    ("Bookstore", "Books", "Entertainment", "Entertainment", 15, 70),
    ("Clothing Boutique", "Clothing", "Shopping", None, 30, 180),
    ("Hardware Store", "Home repair supplies", "Household", "Household", 12, 130),
    ("Pet Supply Shop", "Pet food and supplies", "Household", "Household", 20, 85),
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
    """Enable CAD and USD and make CAD the primary currency"""
    for path in ["/currencies/CAD/enable", "/currencies/USD/enable", "/currencies/CAD/primary"]:
        status, body = api("POST", path, {})
        if status != 200:
            sys.exit(f"Currency setup failed on {path}: {status} {body}")
    print("currencies configured, CAD primary")


def month_starts() -> list[date]:
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


def monthly_dates(day_of_month: int) -> list[date]:
    """Return one date per month clamped to day 28 and the seeded range"""
    dates = []
    for first in month_starts():
        target = first.replace(day=min(day_of_month, 28))
        if START_DATE <= target <= END_DATE:
            dates.append(target)
    return dates


def create_budgets() -> dict[str, int]:
    """Create the budgets with one monthly limit per month and return their ids"""
    budget_ids = {}
    for name, amount in BUDGET_MONTHLY_AMOUNTS.items():
        status, body = api("POST", "/budgets", {"name": name})
        if status != 200:
            sys.exit(f"Budget {name} failed: {status} {body}")
        budget_ids[name] = int(body["data"]["id"])

        for first in month_starts():
            status, body = api("POST", f"/budgets/{budget_ids[name]}/limits", {
                "start": first.isoformat(),
                "end": month_end(first).isoformat(),
                "amount": amount,
                "currency_code": "CAD",
            })
            if status != 200:
                sys.exit(f"Budget limit {name} {first}: {status} {body}")
    print(f"created {len(budget_ids)} budgets with monthly limits")
    return budget_ids


def create_accounts() -> dict[str, dict]:
    """Create the asset and liability accounts and return name to id and currency"""
    definitions = [
        {"name": "Everyday Chequing", "type": "asset", "account_role": "defaultAsset",
         "currency_code": "CAD", "account_number": "003-91234-5678901",
         "opening_balance": "4250.00", "opening_balance_date": "2023-12-31"},
        {"name": "High Interest Savings", "type": "asset", "account_role": "savingAsset",
         "currency_code": "CAD", "opening_balance": "15000.00",
         "opening_balance_date": "2023-12-31"},
        {"name": "Cash Wallet", "type": "asset", "account_role": "cashWalletAsset",
         "currency_code": "CAD"},
        {"name": "Rewards Credit Card", "type": "asset", "account_role": "ccAsset",
         "currency_code": "CAD", "credit_card_type": "monthlyFull",
         "monthly_payment_date": "2024-01-18"},
        {"name": "US Dollar Savings", "type": "asset", "account_role": "savingAsset",
         "currency_code": "USD", "opening_balance": "2000.00",
         "opening_balance_date": "2023-12-31"},
        {"name": "Car Loan", "type": "liabilities", "liability_type": "loan",
         "liability_direction": "debit", "currency_code": "CAD", "interest": "4.9",
         "interest_period": "monthly", "opening_balance": "18500.00",
         "opening_balance_date": "2023-12-31"},
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


def money(low: float, high: float) -> str:
    return f"{rng.uniform(low, high):.2f}"


def random_seed_date() -> date:
    return START_DATE + timedelta(days=rng.randrange((END_DATE - START_DATE).days + 1))


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


def generate_transaction_groups(accounts: dict[str, dict]) -> list[dict]:
    """Generate the deterministic list of transaction group payloads"""
    chequing = accounts["Everyday Chequing"]["id"]
    savings = accounts["High Interest Savings"]["id"]
    cash = accounts["Cash Wallet"]["id"]
    credit_card = accounts["Rewards Credit Card"]["id"]
    usd_savings = accounts["US Dollar Savings"]["id"]
    car_loan = accounts["Car Loan"]["id"]

    groups: list[list[dict]] = []
    titled: dict[int, str] = {}

    def add(*splits: dict, group_title: str | None = None) -> None:
        if group_title:
            titled[len(groups)] = group_title
        groups.append(list(splits))

    # Monthly fixed commitments paid from chequing
    for day in monthly_dates(1):
        add(build_split("withdrawal", day, "1850.00", "Monthly rent", source_id=chequing,
                        destination_name="Maple Grove Properties", category_name="Housing",
                        tags=["rent"]))
    for day in monthly_dates(5):
        add(build_split("withdrawal", day, money(60, 140), "Hydro bill", source_id=chequing,
                        destination_name="Provincial Hydro", category_name="Utilities",
                        budget_name="Household"))
    for day in monthly_dates(8):
        add(build_split("withdrawal", day, "89.99", "Internet service", source_id=chequing,
                        destination_name="Northern Internet Co", category_name="Utilities",
                        budget_name="Household", tags=["subscription"]))
    for day in monthly_dates(12):
        add(build_split("withdrawal", day, "64.50", "Mobile phone plan", source_id=chequing,
                        destination_name="Wireless Provider", category_name="Utilities",
                        budget_name="Household", tags=["subscription"]))
    for day in monthly_dates(15):
        add(build_split("withdrawal", day, "16.99", "Streaming service", source_id=credit_card,
                        destination_name="Streaming Service", category_name="Entertainment",
                        budget_name="Entertainment", tags=["subscription"]))
    for day in monthly_dates(20):
        add(build_split("withdrawal", day, "52.00", "Gym membership", source_id=chequing,
                        destination_name="City Fitness Club", category_name="Health",
                        tags=["subscription"]))
    for day in monthly_dates(25):
        add(build_split("withdrawal", day, "142.35", "Car insurance premium", source_id=chequing,
                        destination_name="National Auto Insurance", category_name="Insurance",
                        budget_name="Transportation"))

    # Debt paydown is a withdrawal whose destination is the liability account,
    # which is how Firefly III models paying off a loan
    for day in monthly_dates(28):
        add(build_split("withdrawal", day, "385.00", "Car loan payment", source_id=chequing,
                        destination_id=car_loan, tags=["loan"]))

    # Monthly transfers into savings and onto the credit card
    for day in monthly_dates(2):
        add(build_split("transfer", day, "500.00", "Automatic savings contribution",
                        source_id=chequing, destination_id=savings))
    for day in monthly_dates(18):
        add(build_split("transfer", day, money(400, 1600), "Credit card payment",
                        source_id=chequing, destination_id=credit_card))

    # Biweekly payroll deposited to chequing
    payday = date(2024, 1, 5)
    while payday <= END_DATE:
        add(build_split("deposit", payday, "2410.66", "Biweekly salary",
                        source_name="Employer Payroll", destination_id=chequing,
                        category_name="Salary", tags=["payroll"]))
        payday += timedelta(days=14)

    # Quarterly interest on both savings accounts, USD interest stays in USD
    for month_day in [(3, 31), (6, 30), (9, 30), (12, 31)]:
        for year in [2024, 2025, 2026]:
            day = date(year, *month_day)
            if START_DATE <= day <= END_DATE:
                add(build_split("deposit", day, money(20, 90), "Savings interest",
                                source_name="Bank Interest", destination_id=savings,
                                category_name="Interest"))
                add(build_split("deposit", day, money(4, 18), "USD savings interest",
                                source_name="Bank Interest", destination_id=usd_savings,
                                category_name="Interest"))

    # Occasional CAD to USD top-ups and one repatriation, with foreign amounts
    for day in monthly_dates(10):
        if rng.random() < 0.4:
            usd_amount = rng.uniform(150, 600)
            cad_amount = usd_amount * USD_CAD_RATE * rng.uniform(0.985, 1.015)
            add(build_split("transfer", day, f"{cad_amount:.2f}",
                            "Move funds to US dollar savings", source_id=chequing,
                            destination_id=usd_savings, foreign_currency_code="USD",
                            foreign_amount=f"{usd_amount:.2f}"))
    add(build_split("transfer", date(2025, 11, 6), "1200.00", "Bring US funds home",
                    source_id=usd_savings, destination_id=chequing,
                    foreign_currency_code="CAD",
                    foreign_amount=f"{1200 * USD_CAD_RATE:.2f}"))

    # Split warehouse runs, one group holding grocery and household portions
    for _ in range(25):
        day = random_seed_date()
        add(
            build_split("withdrawal", day, money(60, 160), "Groceries portion",
                        source_id=credit_card, destination_name="Bulk Warehouse Store",
                        category_name="Groceries", budget_name="Groceries"),
            build_split("withdrawal", day, money(20, 90), "Household portion",
                        source_id=credit_card, destination_name="Bulk Warehouse Store",
                        category_name="Household", budget_name="Household"),
            group_title="Warehouse run",
        )

    # Reserve room for the fixed-count blocks below so the total lands exactly
    # on the target group count
    reserved = 40 + 15
    while len(groups) < TARGET_TRANSACTION_GROUPS - reserved - 60:
        merchant, description, category, budget, low, high = rng.choice(EVERYDAY_SPENDING)
        day = random_seed_date()
        source = rng.choices([chequing, credit_card, cash], weights=[35, 55, 10])[0]

        extra = {}
        if source == chequing and day < date(2025, 1, 1) and rng.random() < 0.3:
            extra["reconciled"] = True
        if rng.random() < 0.05:
            extra["notes"] = f"Auto-seeded note for {description.lower()}"
        add(build_split("withdrawal", day, money(low, high), description, source_id=source,
                        destination_name=merchant, category_name=category,
                        budget_name=budget, **extra))

    # US online purchases from the CAD credit card carry USD foreign amounts
    for _ in range(40):
        day = random_seed_date()
        usd_amount = rng.uniform(10, 220)
        cad_amount = usd_amount * USD_CAD_RATE * rng.uniform(0.99, 1.03)
        add(build_split("withdrawal", day, f"{cad_amount:.2f}", "Online purchase in USD",
                        source_id=credit_card, destination_name="US Online Retailer",
                        category_name="Shopping", tags=["cross-border"],
                        foreign_currency_code="USD", foreign_amount=f"{usd_amount:.2f}"))

    # Direct USD spending from the USD savings account
    for _ in range(15):
        day = random_seed_date()
        add(build_split("withdrawal", day, money(20, 150), "US travel expense",
                        source_id=usd_savings, destination_name="US Hotel and Travel",
                        category_name="Travel", tags=["travel"]))

    # Cash withdrawals modelled as transfers from chequing to the wallet
    while len(groups) < TARGET_TRANSACTION_GROUPS:
        day = random_seed_date()
        add(build_split("transfer", day, rng.choice(["40.00", "60.00", "80.00", "100.00"]),
                        "ATM cash withdrawal", source_id=chequing, destination_id=cash))

    payloads = []
    for index, splits in enumerate(groups):
        payload = {
            "error_if_duplicate_hash": False,
            "apply_rules": False,
            "fire_webhooks": False,
            "transactions": splits,
        }
        if index in titled:
            payload["group_title"] = titled[index]
        payloads.append(payload)
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
        name: {"categories": set(), "first_date": None, "transaction_count": 0,
               "total_spent": Decimal("0")}
        for name in BUDGET_MONTHLY_AMOUNTS
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
                facts["categories"].add(split.get("category_name"))
                facts["transaction_count"] += 1
                facts["total_spent"] += amount
                split_date = date.fromisoformat(split["date"])
                if facts["first_date"] is None or split_date < facts["first_date"]:
                    facts["first_date"] = split_date

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
                "monthly_amount": BUDGET_MONTHLY_AMOUNTS[name],
                "currency": "CAD",
                "limit_months": len(month_starts()),
                "categories": sorted(facts["categories"]),
                "first_transaction_date": facts["first_date"].isoformat(),
                "transaction_count": facts["transaction_count"],
                "total_spent": str(facts["total_spent"]),
            }
            for name, facts in budget_facts.items()
        },
        "categories": sorted(categories),
        "tags": sorted(tags),
    }


def post_transactions(payloads: list[dict]) -> None:
    """Post every transaction group, aborting when failures accumulate"""
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
    create_budgets()
    payloads = generate_transaction_groups(accounts)
    manifest = compute_manifest(accounts, payloads)
    post_transactions(payloads)

    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"manifest written to {MANIFEST_PATH}")
    print(json.dumps({key: manifest[key] for key in
                      ["transaction_groups", "journal_rows", "journal_counts"]}, indent=2))


if __name__ == "__main__":
    main()
