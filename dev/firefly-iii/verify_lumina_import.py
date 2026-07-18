"""Cross-verify a Firefly III import against the seed manifest

Compares three views of the same data after the export files are imported
into Lumina Finance through the app:

- Firefly III account balances, budget limit periods, archived flags,
  categories, and tags from its API against the manifest
- Lumina account balances and transaction rows against the manifest
- Lumina imported budgets against the manifest cadence, archived flag, and
  limit periods, including that every budget the manifest marks as skipped
  stayed out

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

# The manifest stores amounts in major units while Lumina stores minor units,
# and both seeded currencies carry two minor unit digits
MINOR_UNIT_EXPONENT = 2

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


def describe_limits(limits: dict) -> str:
    """Summarise a limit schedule as its period count and distinct amounts"""
    amounts = sorted({str(amount) for amount in limits.values()})
    return f"{len(limits)} periods, {len(amounts)} distinct amounts"


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


def to_minor_units(amount: str) -> int:
    return int((Decimal(amount) * (10 ** MINOR_UNIT_EXPONENT)).to_integral_value())


def verify_firefly_balances(manifest: dict, token: str) -> None:
    """Compare Firefly III computed balances with the manifest"""
    print("Firefly III balances vs manifest")
    balances = fetch_firefly_balances(token)
    for name, expected in manifest["accounts"].items():
        check(f"firefly balance {name}", Decimal(expected["expected_balance"]), balances.get(name))


def verify_firefly_budgets(manifest: dict, token: str) -> None:
    """Compare the budgets Firefly III holds and every limit period with the manifest

    Balances alone cannot show a budget limit posted with the wrong amount or a
    period the seed never wrote, because a limit moves no money. The archived
    flag is checked too, since the import flow decides what to skip off it
    """
    print("Firefly III budgets vs manifest")
    budgets = {
        budget["attributes"]["name"]: budget
        for budget in fetch_firefly_collection("budgets", token)
    }
    check("firefly budget names", sorted(manifest["budgets"]), sorted(budgets))

    for name, expected in manifest["budgets"].items():
        budget = budgets.get(name)
        if budget is None:
            continue
        check(f"firefly budget active {name}", expected["active"], budget["attributes"]["active"])

        limits = fetch_firefly_collection(
            f"budgets/{budget['id']}/limits?start={FIREFLY_QUERY_START}&end={FIREFLY_QUERY_END}",
            token,
        )
        expected_limits = {
            (limit["start"], limit["end"]): (Decimal(limit["amount"]), limit["currency"])
            for limit in expected["limits"]
        }
        actual_limits = {
            (limit["attributes"]["start"][:10], limit["attributes"]["end"][:10]):
                (Decimal(limit["attributes"]["amount"]), limit["attributes"]["currency_code"])
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


def verify_lumina_budgets(manifest: dict, token: str) -> None:
    """Compare imported budgets and their periods with the manifest

    Budgets the manifest marks as skipped must be absent, and every imported
    budget must carry the expected archived flag, cadence, and one period per
    exported limit with the same dates and amount
    """
    print("Lumina budgets vs manifest")
    base_budgets = {budget["name"]: budget for budget in fetch_lumina("/base-budgets", token)}
    instances = fetch_lumina("/budgets", token)
    categories = {category["id"]: category["name"] for category in fetch_lumina("/categories", token)}

    for name, expected in manifest["budgets"].items():
        base = base_budgets.get(name)

        if expected["import"]["outcome"] == "skipped":
            check(f"budget skipped {name}", "absent", "absent" if base is None else "imported")
            continue

        if base is None:
            failures.append(f"budget {name}")
            print(f"  FAIL budget {name}: not found")
            continue

        check(f"budget currency {name}", expected["currencies"][0], base["currency"])

        check(f"budget archived {name}", expected["import"]["is_archived"], base["is_archived"])

        # The cadence is read off the latest limit period on import, so every
        # recurrence field has to match what the seed declared for the shape
        expected_cadence = expected["import"]["cadence"]
        actual_cadence = {field: base[field] for field in expected_cadence}
        check(f"budget cadence {name}", expected_cadence, actual_cadence,
              summary=f"{actual_cadence['recurrence_freq']} x{actual_cadence['instance_length']}, "
                      f"recurs {actual_cadence['recurs']}")

        tracked_names = sorted(categories.get(category_id, "?") for category_id in base["category_ids"])
        check(f"budget categories {name}", expected["categories"], tracked_names)

        # Each exported limit period must arrive as exactly one instance with
        # the same dates and amount, with no gap filling and no extension
        expected_periods = {
            (limit["start"], limit["end"]): to_minor_units(limit["amount"])
            for limit in expected["limits"]
        }
        own_instances = [
            instance for instance in instances if instance["base_budget_id"] == base["id"]
        ]
        actual_periods = {
            (instance["period_start"], instance["period_end"]): instance["overall_limit"]
            for instance in own_instances
        }
        check(f"budget periods {name}", expected_periods, actual_periods,
              summary=describe_limits(expected_periods))


def main() -> None:
    manifest = json.loads(MANIFEST_PATH.read_text())

    firefly_token = mint_firefly_token()
    verify_firefly_balances(manifest, firefly_token)
    verify_firefly_budgets(manifest, firefly_token)
    verify_firefly_categories_and_tags(manifest, firefly_token)

    lumina_token = login_lumina()
    account_ids = verify_lumina_accounts(manifest, lumina_token)
    asyncio.run(verify_lumina_rows(manifest, account_ids))
    verify_lumina_budgets(manifest, lumina_token)

    if failures:
        sys.exit(f"\n{len(failures)} checks failed: {failures}")
    print("\nAll checks passed")


if __name__ == "__main__":
    main()
