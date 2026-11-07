"""In-memory scenarios the fake Akahu serves

A scenario stands for one Akahu personal app: its accounts and transactions, reached by one pair of
tokens. Each test creates its own scenario, so tests sharing one fake never see each other's data
"""

import itertools
import secrets
from dataclasses import dataclass, field

# Transactions a page holds unless a scenario sets another number. Akahu sends up to 100
DEFAULT_PAGE_SIZE = 100


@dataclass
class Transaction:
    """A transaction as Akahu holds it, the amount kept exactly as the test gave it"""

    id: str

    # An ISO 8601 UTC timestamp
    date: str
    amount: str
    description: str


@dataclass
class Account:
    """An account as Akahu lists it"""

    id: str
    connection_id: str
    connection_name: str
    name: str
    status: str
    currency: str
    balance: str
    attributes: list[str] = field(default_factory=lambda: ["TRANSACTIONS"])
    transactions: list[Transaction] = field(default_factory=list)

    # Pending transactions have no id in Akahu
    pending: list[Transaction] = field(default_factory=list)


@dataclass
class Scenario:
    """One personal app, reached by its tokens until they are revoked"""

    id: str
    app_id_token: str
    user_access_token: str
    accounts: list[Account] = field(default_factory=list)
    page_size: int = DEFAULT_PAGE_SIZE
    are_tokens_revoked: bool = False


class FakeAkahu:
    """Every scenario the fake holds"""

    def __init__(self) -> None:
        """Start with no scenarios"""
        self.scenarios: dict[str, Scenario] = {}
        self._numbers = itertools.count(1001)

    def create_scenario(self) -> Scenario:
        """Start an empty scenario with a pair of tokens of its own"""
        scenario_id = secrets.token_urlsafe(8)
        scenario = Scenario(
            id=scenario_id,
            app_id_token=f"app_token_fake{secrets.token_urlsafe(18)}",
            user_access_token=f"user_token_fake{secrets.token_urlsafe(24)}",
        )
        self.scenarios[scenario_id] = scenario
        return scenario

    def new_id(self, prefix: str) -> str:
        """Return an id no other object of the kind has"""
        return f"{prefix}_{next(self._numbers)}"

    def find_by_tokens(self, user_access_token: str | None, app_id_token: str | None) -> Scenario | None:
        """Return the scenario a pair of tokens reaches, or None for an unknown pair or revoked tokens"""
        if user_access_token is None or app_id_token is None:
            return None
        for scenario in self.scenarios.values():
            if (
                secrets.compare_digest(scenario.user_access_token, user_access_token)
                and secrets.compare_digest(scenario.app_id_token, app_id_token)
                and not scenario.are_tokens_revoked
            ):
                return scenario
        return None


akahu = FakeAkahu()
