"""Cross-verify a Firefly III import against the seed manifest

Compares three views of the same data after the export files are imported
into Lumina Finance through the app:

- Firefly III account balances from its API against the manifest
- Lumina account balances and transaction rows against the manifest
- Lumina imported budgets against the manifest budget parameters

Lumina reads use the app API for balances and budgets plus direct SQL for
row-count aggregates. Run with the backend virtual environment so asyncpg is
available, from the backend directory so its dotenv is picked up:
    cd backend && set -a && source .env && set +a && \
        .venv/bin/python ../dev/firefly-iii/verify_lumina_import.py
"""

import asyncio
import http.cookiejar
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import asyncpg

MANIFEST_PATH = Path(__file__).with_name("firefly_seed_manifest.json")

FIREFLY_URL = os.environ.get("FIREFLY_URL", "http://localhost:8080")
FIREFLY_EMAIL = os.environ.get("FIREFLY_EMAIL", "test@example.com")
FIREFLY_PASSWORD = os.environ.get("FIREFLY_PASSWORD", "passwordpassword")

LUMINA_URL = os.environ.get("LUMINA_URL", "http://localhost:56507")
LUMINA_EMAIL = os.environ.get("LUMINA_EMAIL", "firefly-e2e@example.com")
LUMINA_PASSWORD = os.environ.get("LUMINA_PASSWORD", "FireflyImport2026!")

# The manifest stores balances in major units while Lumina stores minor units
CAD_EXPONENT = 2

failures: list[str] = []


def check(label: str, expected, actual) -> None:
    """Record one comparison and print its outcome"""
    if expected == actual:
        print(f"  PASS {label}: {actual}")
    else:
        failures.append(label)
        print(f"  FAIL {label}: expected {expected}, got {actual}")


def http_json(url: str, method: str = "GET", payload: dict | None = None,
              headers: dict | None = None, opener=None) -> tuple[int, dict | list]:
    """Send an HTTP request and return status with parsed JSON"""
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Accept": "application/json", "Content-Type": "application/json", **(headers or {})},
    )
    active_opener = opener or urllib.request.build_opener()
    try:
        with active_opener.open(req) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as err:
        body = err.read().decode(errors="replace")
        try:
            return err.code, json.loads(body)
        except json.JSONDecodeError:
            return err.code, {"raw": body}


def mint_firefly_token() -> str:
    """Log into Firefly III with the seed user and mint an API token"""
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    with opener.open(f"{FIREFLY_URL}/login") as resp:
        page = resp.read().decode(errors="replace")
    token = re.search(r'name="_token" value="([^"]+)"', page).group(1)

    form = urllib.parse.urlencode({
        "_token": token,
        "email": FIREFLY_EMAIL,
        "password": FIREFLY_PASSWORD,
        "remember": "1",
    }).encode()
    login_req = urllib.request.Request(
        f"{FIREFLY_URL}/login", method="POST", data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    opener.open(login_req)

    with opener.open(f"{FIREFLY_URL}/profile") as resp:
        profile = resp.read().decode(errors="replace")
    csrf = re.search(r'name="csrf-token" content="([^"]+)"', profile).group(1)

    status, body = http_json(
        f"{FIREFLY_URL}/oauth/personal-access-tokens", method="POST",
        payload={"name": "verifier", "scopes": []},
        headers={"X-CSRF-TOKEN": csrf, "X-Requested-With": "XMLHttpRequest"},
        opener=opener,
    )
    if status != 200:
        sys.exit(f"Could not mint a Firefly III token: {status} {body}")
    return body["accessToken"]


def fetch_firefly_balances(token: str) -> dict[str, Decimal]:
    """Return current balances by account name from the Firefly III API"""
    balances: dict[str, Decimal] = {}
    page = 1
    while True:
        status, body = http_json(
            f"{FIREFLY_URL}/api/v1/accounts?limit=50&page={page}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if status != 200:
            sys.exit(f"Firefly III accounts request failed: {status}")
        for account in body["data"]:
            attributes = account["attributes"]
            if attributes["type"] in ("asset", "liabilities", "loan", "debt", "mortgage"):
                balances[attributes["name"]] = Decimal(attributes["current_balance"])
        if page >= body["meta"]["pagination"]["total_pages"]:
            return balances
        page += 1


def login_lumina() -> str:
    """Log into Lumina with the test account and return the access token"""
    status, body = http_json(
        f"{LUMINA_URL}/auth/login", method="POST",
        payload={"email": LUMINA_EMAIL, "password": LUMINA_PASSWORD},
    )
    if status != 200:
        sys.exit(f"Lumina login failed: {status} {body}")
    return body["access_token"]


def fetch_lumina(path: str, token: str):
    """Return parsed JSON from an authenticated Lumina API request"""
    status, body = http_json(f"{LUMINA_URL}{path}", headers={"Authorization": f"Bearer {token}"})
    if status != 200:
        sys.exit(f"Lumina request {path} failed: {status} {body}")
    return body


async def fetch_lumina_row_aggregates(account_ids: dict[str, str]) -> dict[str, tuple[int, int]]:
    """Return transaction count and amount sum per account name from the database"""
    connection = await asyncpg.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "55507")),
        user=os.environ.get("DB_USER", "lumina"),
        password=os.environ.get("DB_PASSWORD", "lumina"),
        database=os.environ.get("DB_NAME", "lumina"),
    )
    try:

        # Aggregate imported rows per account to compare with the manifest
        rows = await connection.fetch(
            "SELECT account_id::text AS account_id, COUNT(*) AS row_count, SUM(amount) AS amount_sum"
            " FROM transactions GROUP BY account_id",
        )
    finally:
        await connection.close()

    by_account_id = {row["account_id"]: (row["row_count"], int(row["amount_sum"])) for row in rows}
    return {name: by_account_id.get(account_id, (0, 0)) for name, account_id in account_ids.items()}


def month_start(day: date) -> date:
    return day.replace(day=1)


def months_between_inclusive(start: date, end: date) -> int:
    """Return the number of month periods from start through end's month"""
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


def to_minor_units(amount: str) -> int:
    return int((Decimal(amount) * (10 ** CAD_EXPONENT)).to_integral_value())


def verify_firefly_balances(manifest: dict) -> None:
    """Compare Firefly III computed balances with the manifest"""
    print("Firefly III balances vs manifest")
    token = mint_firefly_token()
    balances = fetch_firefly_balances(token)
    for name, expected in manifest["accounts"].items():
        check(f"firefly balance {name}", Decimal(expected["expected_balance"]), balances.get(name))


def verify_lumina_accounts(manifest: dict, token: str) -> dict[str, str]:
    """Compare Lumina balances with the manifest and return account ids by name"""
    print("Lumina account balances vs manifest")
    accounts = fetch_lumina("/accounts", token)
    accounts_by_name = {account["name"]: account for account in accounts}
    account_ids: dict[str, str] = {}

    for name, expected in manifest["accounts"].items():
        account = accounts_by_name.get(name)
        if account is None:
            failures.append(f"lumina account {name}")
            print(f"  FAIL lumina account {name}: not found")
            continue
        account_ids[name] = account["id"]
        expected_minor = to_minor_units(expected["expected_balance"])
        check(f"lumina balance {name}", expected_minor, account["current_balance"])
        check(f"lumina currency {name}", expected["currency"], account["currency"])
    return account_ids


async def verify_lumina_rows(manifest: dict, account_ids: dict[str, str]) -> None:
    """Compare per-account row counts and sums with the manifest"""
    print("Lumina transaction rows vs manifest")
    aggregates = await fetch_lumina_row_aggregates(account_ids)
    for name, expected in manifest["accounts"].items():
        if name not in account_ids:
            continue
        row_count, amount_sum = aggregates[name]

        # Opening balances add one adjustment row beyond the journal legs
        expected_rows = expected["journal_rows"] + (1 if Decimal(expected["opening_balance"]) != 0 else 0)
        check(f"lumina row count {name}", expected_rows, row_count)
        check(f"lumina amount sum {name}", to_minor_units(expected["expected_balance"]), amount_sum)


def verify_lumina_budgets(manifest: dict, token: str, today: date) -> None:
    """Compare imported budgets and their instances with the manifest"""
    print("Lumina budgets vs manifest")
    base_budgets = {budget["name"]: budget for budget in fetch_lumina("/base-budgets", token)}
    instances = fetch_lumina("/budgets", token)
    categories = {category["id"]: category["name"] for category in fetch_lumina("/categories", token)}

    for name, expected in manifest["budgets"].items():
        base = base_budgets.get(name)
        if base is None:
            failures.append(f"budget {name}")
            print(f"  FAIL budget {name}: not found")
            continue

        check(f"budget currency {name}", expected["currency"], base["currency"])
        check(f"budget cadence {name}", "monthly", base["recurrence_freq"])
        tracked_names = sorted(categories.get(category_id, "?") for category_id in base["category_ids"])
        check(f"budget categories {name}", expected["categories"], tracked_names)

        expected_start = month_start(date.fromisoformat(expected["first_transaction_date"]))
        own_instances = [
            instance for instance in instances if instance["base_budget_id"] == base["id"]
        ]
        first_start = min(date.fromisoformat(instance["period_start"]) for instance in own_instances)
        check(f"budget backdate {name}", expected_start, first_start)
        check(
            f"budget instance count {name}",
            months_between_inclusive(expected_start, today),
            len(own_instances),
        )
        limits = {instance["overall_limit"] for instance in own_instances}
        check(f"budget limit {name}", {to_minor_units(expected["monthly_amount"])}, limits)


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())
    today = date.today()

    verify_firefly_balances(manifest)
    lumina_token = login_lumina()
    account_ids = verify_lumina_accounts(manifest, lumina_token)
    asyncio.run(verify_lumina_rows(manifest, account_ids))
    verify_lumina_budgets(manifest, lumina_token, today)

    if failures:
        sys.exit(f"\n{len(failures)} checks failed: {failures}")
    print("\nAll checks passed")


if __name__ == "__main__":
    main()
