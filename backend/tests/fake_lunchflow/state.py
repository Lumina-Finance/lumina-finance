"""In-memory scenarios the fake Lunch Flow serves

A scenario stands for one Lunch Flow user: their accounts and transactions, reached by one API key.
Each test creates its own scenario, so tests sharing one fake never see each other's data
"""

import itertools
import secrets
from dataclasses import dataclass, field

# Account and connection ids count up from here across scenarios, so one id never names two accounts
# or two connections
FIRST_ACCOUNT_ID = 1001
FIRST_CONNECTION_ID = 501


@dataclass
class Transaction:
    """A transaction as Lunch Flow holds it, the amount kept exactly as the test gave it"""

    id: str
    amount: str
    currency: str
    date: str
    merchant: str | None
    description: str | None
    is_pending: bool


@dataclass
class Account:
    """An account as Lunch Flow lists it"""

    id: int
    connection_id: int
    name: str
    institution_name: str
    currency: str
    status: str
    balance: str
    transactions: list[Transaction] = field(default_factory=list)


@dataclass
class Scenario:
    """One Lunch Flow user, reached by an API key until it is revoked"""

    id: str
    api_key: str
    accounts: list[Account] = field(default_factory=list)
    is_key_revoked: bool = False


class FakeLunchFlow:
    """Every scenario the fake holds"""

    def __init__(self) -> None:
        """Start with no scenarios"""
        self.scenarios: dict[str, Scenario] = {}
        self._account_ids = itertools.count(FIRST_ACCOUNT_ID)
        self._connection_ids = itertools.count(FIRST_CONNECTION_ID)

    def create_scenario(self) -> Scenario:
        """Start an empty scenario with a key of its own"""
        scenario_id = secrets.token_urlsafe(8)
        scenario = Scenario(id=scenario_id, api_key=f"lf_fake_{secrets.token_urlsafe(24)}")
        self.scenarios[scenario_id] = scenario
        return scenario

    def new_account_id(self) -> int:
        """Return an account id no other account has"""
        return next(self._account_ids)

    def new_connection_id(self) -> int:
        """Return a connection id no other connection has"""
        return next(self._connection_ids)

    def find_by_key(self, api_key: str | None) -> Scenario | None:
        """Return the scenario a key reaches, or None for an unknown or revoked key"""
        for scenario in self.scenarios.values():
            if api_key is not None and secrets.compare_digest(scenario.api_key, api_key) and not scenario.is_key_revoked:
                return scenario
        return None


lunchflow = FakeLunchFlow()
