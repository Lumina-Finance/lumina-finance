"""In-memory scenarios the fake Pluggy serves

A scenario stands for one Pluggy application: its items, accounts and transactions, reached by one
client ID and secret. Each test creates its own scenario, so tests sharing one fake never see each
other's data
"""

import secrets
import uuid
from dataclasses import dataclass, field

# Transactions a page holds unless a scenario sets another number. Pluggy's pages hold 500
DEFAULT_PAGE_SIZE = 500


@dataclass
class Transaction:
    """A transaction as Pluggy holds it, the amount kept exactly as the test gave it"""

    id: str

    # An ISO 8601 UTC timestamp, at exactly midnight for a date with no time
    date: str
    amount: str
    description: str
    status: str = "POSTED"

    # Set when the transaction is in a currency other than its account's
    currency: str | None = None
    amount_in_account_currency: str | None = None


@dataclass
class Account:
    """An account as Pluggy lists it"""

    id: str
    type: str
    name: str
    balance: str
    currency: str
    transactions: list[Transaction] = field(default_factory=list)


@dataclass
class Item:
    """One bank connection of the application"""

    id: str
    connector_id: int
    connector_name: str
    status: str = "UPDATED"
    execution_status: str = "SUCCESS"
    accounts: list[Account] = field(default_factory=list)


@dataclass
class Scenario:
    """One Pluggy application, reached by its client ID and secret until the secret is revoked"""

    id: str
    client_id: str
    client_secret: str
    items: list[Item] = field(default_factory=list)
    page_size: int = DEFAULT_PAGE_SIZE
    is_secret_revoked: bool = False


class FakePluggy:
    """Every scenario the fake holds, and the API keys it handed out"""

    def __init__(self) -> None:
        """Start with no scenarios"""
        self.scenarios: dict[str, Scenario] = {}
        self._api_keys: dict[str, str] = {}

    def create_scenario(self) -> Scenario:
        """Start an empty scenario with a client ID and secret of its own"""
        scenario = Scenario(id=secrets.token_urlsafe(8), client_id=str(uuid.uuid4()), client_secret=str(uuid.uuid4()))
        self.scenarios[scenario.id] = scenario
        return scenario

    def sign_in(self, client_id: str, client_secret: str) -> str | None:
        """Return a new API key for a client ID and secret, or None for a pair that is unknown or revoked"""
        for scenario in self.scenarios.values():
            if (
                secrets.compare_digest(scenario.client_id, client_id)
                and secrets.compare_digest(scenario.client_secret, client_secret)
                and not scenario.is_secret_revoked
            ):
                api_key = f"fake-key-{secrets.token_urlsafe(24)}"
                self._api_keys[api_key] = scenario.id
                return api_key
        return None

    def find_by_api_key(self, api_key: str | None) -> Scenario | None:
        """Return the scenario an API key reaches, or None for an unknown key or a revoked secret"""
        scenario = self.scenarios.get(self._api_keys.get(api_key or "", ""))
        return scenario if scenario is not None and not scenario.is_secret_revoked else None


pluggy = FakePluggy()
