"""In-memory scenarios the fake SimpleFIN Bridge serves

A scenario stands for one Bridge user: their connections, accounts and transactions, the errors and
fault their responses carry, and the setup tokens and access credentials that reach them. Each test
creates its own scenario, so tests sharing one fake never see each other's data
"""

import asyncio
import hmac
import secrets
from dataclasses import dataclass, field
from enum import StrEnum


class FaultKind(StrEnum):
    """A Bridge behaviour that replaces or accompanies a scenario's normal responses"""

    # The accounts come back with a warning that requests are over the daily quota
    QUOTA_WARNING = "quota_warning"

    # Only the quota warning comes back, with no accounts
    QUOTA_WARNING_WITHOUT_DATA = "quota_warning_without_data"

    PAYMENT_REQUIRED = "payment_required"
    RATE_LIMITED = "rate_limited"

    # An error page from in front of the Bridge rather than a SimpleFIN response
    HTML_ERROR = "html_error"

    # No answer before the client's read timeout
    TIMEOUT = "timeout"


@dataclass
class Fault:
    """The fault a scenario's responses show until it is cleared"""

    kind: FaultKind

    # The HTML error page's status, and None for every other kind
    status: int | None


@dataclass
class Connection:
    """One bank login on the Bridge, with an org_id that names its institution"""

    conn_id: str
    name: str
    org_id: str
    org_url: str | None


@dataclass
class Transaction:
    """A transaction as the Bridge holds it, with amounts kept exactly as the test gave them"""

    id: str
    amount: str
    description: str
    payee: str
    memo: str
    pending: bool

    # Epoch seconds. A pending transaction goes out with 0 whatever this holds
    posted: int | None
    transacted_at: int | None


@dataclass
class Account:
    """A bank account on one of the scenario's connections"""

    id: str
    name: str
    conn_id: str
    currency: str
    balance: str
    available_balance: str | None

    # Epoch seconds, or None to report the time of each response
    balance_date: int | None

    # Left out of every response while set, as a vanished bank account is
    hidden: bool = False
    transactions: list[Transaction] = field(default_factory=list)


@dataclass
class BankError:
    """An errlist entry every response carries until the scenario's errors are cleared"""

    code: str
    msg: str
    conn_id: str | None
    account_id: str | None


@dataclass
class Scenario:
    """Everything one test's setup tokens and access credentials reach"""

    id: str
    connections: list[Connection] = field(default_factory=list)
    accounts: list[Account] = field(default_factory=list)
    errors: list[BankError] = field(default_factory=list)
    fault: Fault | None = None

    # Set once the fault is cleared or replaced. That frees the requests a timeout fault holds
    stalls_released: asyncio.Event = field(default_factory=asyncio.Event)

    # Set once the fault shown now holds a request, so a test can free one only after it is held
    request_held: asyncio.Event = field(default_factory=asyncio.Event)

    def change_fault(self, fault: Fault | None) -> None:
        """Show another fault, or none, freeing the requests the one before held"""
        self.fault = fault
        self.stalls_released.set()
        self.stalls_released = asyncio.Event()
        self.request_held.clear()


@dataclass
class Access:
    """The credentials one claimed setup token handed out"""

    scenario: Scenario
    password: str
    revoked: bool = False


@dataclass
class Bridge:
    """Every scenario, unclaimed setup token and access credential the running fake knows"""

    scenarios: dict[str, Scenario] = field(default_factory=dict)

    # Claim token to its scenario. Claiming removes the token. That is what makes it single use
    setup_tokens: dict[str, Scenario] = field(default_factory=dict)

    # Basic auth username to the access it identifies
    accesses: dict[str, Access] = field(default_factory=dict)

    def create_scenario(self) -> Scenario:
        """Start an empty scenario under an unguessable id"""
        scenario = Scenario(id=secrets.token_urlsafe(16))
        self.scenarios[scenario.id] = scenario
        return scenario

    def mint_setup_token(self, scenario: Scenario) -> str:
        """Return a new claim token for the scenario"""
        token = secrets.token_urlsafe(24)
        self.setup_tokens[token] = scenario
        return token

    def claim(self, token: str) -> tuple[str, str] | None:
        """Spend a claim token and return the username and password it grants, or None if it is unknown or spent"""
        scenario = self.setup_tokens.pop(token, None)
        if scenario is None:
            return None
        username, password = secrets.token_hex(16), secrets.token_urlsafe(24)
        self.accesses[username] = Access(scenario=scenario, password=password)
        return username, password

    def find_access(self, username: str, password: str) -> Access | None:
        """Return the access these credentials identify, revoked or not"""
        access = self.accesses.get(username)
        if access is None or not hmac.compare_digest(access.password, password):
            return None
        return access

    def revoke(self, scenario: Scenario) -> None:
        """Revoke every access the scenario's tokens have handed out so far, leaving later claims working"""
        for access in self.accesses.values():
            if access.scenario is scenario:
                access.revoked = True


# One process serves every test, so this is shared by them all and kept apart by scenario
bridge = Bridge()
