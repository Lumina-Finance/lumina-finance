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

# The budget limits endpoint answers with one default page and only the current
# period unless both are given, which would drop a budget's earlier limits and
# read as the seed never having written them
FIREFLY_PAGE_SIZE = 200
FIREFLY_QUERY_START = "2000-01-01"
FIREFLY_QUERY_END = "2099-12-31"

FIREFLY_URL = os.environ.get("FIREFLY_URL", "http://localhost:8080")
FIREFLY_EMAIL = os.environ.get("FIREFLY_EMAIL", "test@example.com")
FIREFLY_PASSWORD = os.environ.get("FIREFLY_PASSWORD", "passwordpassword")

LUMINA_URL = os.environ.get("LUMINA_URL", "http://localhost:56507")
LUMINA_EMAIL = os.environ.get("LUMINA_EMAIL", "firefly-e2e@example.com")
LUMINA_PASSWORD = os.environ.get("LUMINA_PASSWORD", "FireflyImport2026!")

# The manifest stores balances in major units while Lumina stores minor units
CAD_EXPONENT = 2

failures: list[str] = []


def check(label: str, expected, actual, summary: str | None = None) -> None:
    """Record one comparison and print its outcome

    Args:
        label: What the comparison is about
        expected: Value the manifest calls for
        actual: Value the system under test reports
        summary: Stands in for the value on a pass, for comparisons whose values
            run too long to read, since a failure still prints both in full
    """
    if expected == actual:
        print(f"  PASS {label}: {actual if summary is None else summary}")
    else:
        failures.append(label)
        print(f"  FAIL {label}: expected {expected}, got {actual}")


def describe_limits(limits: dict[str, object]) -> str:
    """Summarise a limit schedule as its period count and the distinct amounts"""
    amounts = sorted({str(amount) for amount in limits.values()}, key=Decimal)
    return f"{len(limits)} periods, amounts {', '.join(amounts)}"


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


def fetch_firefly_collection(path: str, token: str) -> list[dict]:
    """Return every entry of a paginated Firefly III collection

    Args:
        path: API path below /api/v1, including any query string of its own
        token: Bearer token for the seeded user

    Returns:
        The data entries gathered across every page
    """
    entries: list[dict] = []
    page = 1
    while True:
        separator = "&" if "?" in path else "?"
        status, body = http_json(
            f"{FIREFLY_URL}/api/v1/{path}{separator}limit={FIREFLY_PAGE_SIZE}&page={page}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if status != 200:
            sys.exit(f"Firefly III {path} request failed: {status}")
        entries.extend(body["data"])
        if page >= body["meta"]["pagination"]["total_pages"]:
            return entries
        page += 1


def fetch_firefly_balances(token: str) -> dict[str, Decimal]:
    """Return current balances by account name from the Firefly III API"""
    return {
        account["attributes"]["name"]: Decimal(account["attributes"]["current_balance"])
        for account in fetch_firefly_collection("accounts", token)
        if account["attributes"]["type"] in ("asset", "liabilities", "loan", "debt", "mortgage")
    }


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


def expected_instance_limits(limits: list[dict], start: date, today: date) -> dict[str, int]:
    """Expand Firefly III's limit rows into the amount Lumina holds for each month

    Firefly III only stores a limit for the periods a budget was given one,
    while Lumina materialises an instance for every month from the backdated
    start through today. A month past the last limit therefore keeps the amount
    last in force, which is what a budget the user stopped setting limits for
    looks like once imported, and a month before the first limit takes the
    earliest amount

    Args:
        limits: Limit rows from the manifest, ascending by start
        start: Month the budget is backdated to
        today: Day the import ran, which is the last month materialised

    Returns:
        Period start in ISO form mapped to the limit in minor units
    """
    schedule = [(date.fromisoformat(limit["start"]), limit["amount"]) for limit in limits]
    expanded = {}
    month = start
    while month <= today:
        in_force = [amount for effective_from, amount in schedule if effective_from <= month]
        expanded[month.isoformat()] = to_minor_units(in_force[-1] if in_force else schedule[0][1])
        month = month_start(month + timedelta(days=32))
    return expanded


def verify_firefly_balances(manifest: dict, token: str) -> None:
    """Compare Firefly III computed balances with the manifest"""
    print("Firefly III balances vs manifest")
    balances = fetch_firefly_balances(token)
    for name, expected in manifest["accounts"].items():
        check(f"firefly balance {name}", Decimal(expected["expected_balance"]), balances.get(name))


def verify_firefly_budgets(manifest: dict, token: str) -> None:
    """Compare the budgets Firefly III holds and every limit period with the manifest

    Balances alone cannot show a budget limit posted with the wrong amount or a
    period the seed never wrote, because a limit moves no money
    """
    print("Firefly III budgets vs manifest")
    budget_ids = {
        budget["attributes"]["name"]: budget["id"]
        for budget in fetch_firefly_collection("budgets", token)
    }
    check("firefly budget names", sorted(manifest["budgets"]), sorted(budget_ids))

    for name, expected in manifest["budgets"].items():
        budget_id = budget_ids.get(name)
        if budget_id is None:
            continue

        limits = fetch_firefly_collection(
            f"budgets/{budget_id}/limits?start={FIREFLY_QUERY_START}&end={FIREFLY_QUERY_END}",
            token,
        )
        expected_limits = {limit["start"]: Decimal(limit["amount"]) for limit in expected["limits"]}
        actual_limits = {
            limit["attributes"]["start"][:10]: Decimal(limit["attributes"]["amount"])
            for limit in limits
        }
        check(f"firefly budget limits {name}", expected_limits, actual_limits,
              summary=describe_limits(expected_limits))


def verify_firefly_categories_and_tags(manifest: dict, token: str) -> None:
    """Compare the categories and tags Firefly III holds with the manifest

    A category or tag the seed meant to attach but never did leaves every
    balance intact, so only the names themselves show it
    """
    print("Firefly III categories and tags vs manifest")
    check(
        "firefly categories", manifest["categories"],
        sorted(category["attributes"]["name"]
               for category in fetch_firefly_collection("categories", token)),
    )
    check(
        "firefly tags", manifest["tags"],
        sorted(tag["attributes"]["tag"] for tag in fetch_firefly_collection("tags", token)),
    )


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

        # Firefly III stores an amount per limit period, so every imported
        # period is checked against the amount that was in force at the time
        # rather than against one figure for the whole history
        expected_limits = expected_instance_limits(expected["limits"], expected_start, today)
        actual_limits = {
            instance["period_start"]: instance["overall_limit"] for instance in own_instances
        }
        check(f"budget limits {name}", expected_limits, actual_limits,
              summary=describe_limits(expected_limits))


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())
    today = date.today()

    firefly_token = mint_firefly_token()
    verify_firefly_balances(manifest, firefly_token)
    verify_firefly_budgets(manifest, firefly_token)
    verify_firefly_categories_and_tags(manifest, firefly_token)

    lumina_token = login_lumina()
    account_ids = verify_lumina_accounts(manifest, lumina_token)
    asyncio.run(verify_lumina_rows(manifest, account_ids))
    verify_lumina_budgets(manifest, lumina_token, today)

    if failures:
        sys.exit(f"\n{len(failures)} checks failed: {failures}")
    print("\nAll checks passed")


if __name__ == "__main__":
    main()
