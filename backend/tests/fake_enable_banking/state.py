"""In-memory scenarios the fake Enable Banking serves

A scenario stands for one Enable Banking application: its banks, the accounts a user would share at
them, the authorizations started with it and the sessions they made. It is reached only by tokens its
own private key signed, so tests sharing one fake never see each other's data. The fake keeps the
public half and hands the private half to the test, as Enable Banking's Control Panel hands it to a user
"""

import secrets
import uuid
from dataclasses import dataclass, field

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

# Transactions a page holds unless a scenario sets another number
DEFAULT_PAGE_SIZE = 100


@dataclass
class Transaction:
    """A transaction as the bank holds it, the amount kept exactly as the test gave it, unsigned"""

    id: str | None
    booking_date: str | None
    amount: str
    indicator: str
    description: str
    status: str = "BOOK"
    currency: str | None = None


@dataclass
class Account:
    """An account the bank would share"""

    identification_hash: str
    name: str
    currency: str
    cash_account_type: str = "CACC"

    # Balance type to amount, such as {"CLBD": "1500.50"}
    balances: dict[str, str] = field(default_factory=dict)
    transactions: list[Transaction] = field(default_factory=list)

    # An Enable Banking error code every read of the account answers with, such as ASPSP_PSU_ACTION_REQUIRED
    error: str | None = None


@dataclass
class Authorization:
    """A sign-in at a bank that was started and not yet finished"""

    id: str
    bank_name: str
    country: str
    state: str
    redirect_url: str
    code: str | None = None


@dataclass
class Session:
    """What a finished sign-in granted: the accounts, each under a uid that lasts as long as the session"""

    id: str
    bank_name: str
    country: str
    uids: dict[str, str]
    status: str = "AUTHORIZED"


@dataclass
class Bank:
    """A bank Enable Banking lists"""

    name: str
    country: str
    maximum_consent_validity: int = 7_776_000


@dataclass
class Scenario:
    """One Enable Banking application, reached by tokens its private key signs"""

    id: str
    application_id: str
    private_key: str
    public_key: RSAPublicKey
    banks: list[Bank] = field(default_factory=list)
    accounts: list[Account] = field(default_factory=list)
    authorizations: dict[str, Authorization] = field(default_factory=dict)
    sessions: dict[str, Session] = field(default_factory=dict)

    # The redirect URLs the application registered. While empty, any address is accepted
    redirect_urls: list[str] = field(default_factory=list)
    page_size: int = DEFAULT_PAGE_SIZE

    # How many days back the bank shares transactions, today included, as many do once the hour after
    # sign-in has passed. None shares them all
    history_days: int | None = None


class FakeEnableBanking:
    """Every scenario the fake holds"""

    def __init__(self) -> None:
        """Start with no scenarios"""
        self.scenarios: dict[str, Scenario] = {}

    def create_scenario(self) -> Scenario:
        """Start a scenario with a new application ID and key pair, and no banks or accounts"""
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        scenario = Scenario(id=secrets.token_urlsafe(8), application_id=str(uuid.uuid4()), private_key=pem, public_key=key.public_key())
        self.scenarios[scenario.id] = scenario
        return scenario

    def find_by_application(self, application_id: str) -> Scenario | None:
        """Return the scenario of an application ID, or None for one the fake doesn't know"""
        return next((scenario for scenario in self.scenarios.values() if scenario.application_id == application_id), None)


enable_banking = FakeEnableBanking()
