"""Shared model enums and base mappings"""

import enum

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models"""

    pass


# --- Auth ---

class AuthProvider(enum.StrEnum):
    """Authentication provider identifiers"""

    PASSWORD = "password"  # noqa: S105 — enum value, not a hardcoded secret
    WEBAUTHN = "webauthn"
    OIDC = "oidc"


class AuthTokenKind(enum.StrEnum):
    """Authentication token allowlist kinds"""

    ACCESS = "access"
    REFRESH = "refresh"


# --- Institutions ---

class InstitutionStatus(enum.StrEnum):
    """Institution curation states"""

    CANONICAL = "canonical"
    PENDING = "pending"


# --- Accounts ---

class TaxTreatment(enum.StrEnum):
    """Tax treatment categories for account reporting"""

    TAXABLE = "taxable"          # e.g., checking, savings, investment
    TAX_FREE = "tax_free"        # e.g., TFSA, Roth IRA, FHSA
    TAX_DEFERRED = "tax_deferred"  # e.g., RRSP, 401k, traditional IRA
    TAX_ASSISTED = "tax_assisted"  # e.g., RESP — grants/matching


class AccountKind(enum.StrEnum):
    """High-level account groups for balance and debt behaviour"""

    # Split liabilities into revolving (credit cards, lines of credit, HELOCs —
    # purchases already expensed at time of swipe) vs amortizing (loans,
    # mortgages — payments represent real ongoing cash outflow). The
    # distinction is load-bearing for the runway calculation and makes the
    # difference visible to users at account-creation time.
    ASSET = "asset"
    REVOLVING = "revolving"
    AMORTIZING = "amortizing"


class AccountType(enum.StrEnum):
    """Detailed account type identifiers"""

    # Asset subtypes
    CHECKING = "checking"
    SAVINGS = "savings"
    TERM_DEPOSIT = "term_deposit"
    CASH = "cash"
    INVESTMENT = "investment"
    # Revolving-credit subtypes
    CREDIT_CARD = "credit_card"
    LINE_OF_CREDIT = "line_of_credit"
    HELOC = "heloc"
    # Amortizing-debt subtypes
    LOAN = "loan"
    MORTGAGE = "mortgage"


# Source of truth for which AccountType belongs to which AccountKind. The Account.account_kind
# column on each row is validated against this mapping at create/update time so the two stay in sync
ACCOUNT_KIND_BY_TYPE: dict[AccountType, AccountKind] = {
    AccountType.CHECKING: AccountKind.ASSET,
    AccountType.SAVINGS: AccountKind.ASSET,
    AccountType.TERM_DEPOSIT: AccountKind.ASSET,
    AccountType.CASH: AccountKind.ASSET,
    AccountType.INVESTMENT: AccountKind.ASSET,
    AccountType.CREDIT_CARD: AccountKind.REVOLVING,
    AccountType.LINE_OF_CREDIT: AccountKind.REVOLVING,
    AccountType.HELOC: AccountKind.REVOLVING,
    AccountType.LOAN: AccountKind.AMORTIZING,
    AccountType.MORTGAGE: AccountKind.AMORTIZING,
}

# Fail-fast: every AccountType variant must be mapped, so adding a variant without mapping it crashes at import
if set(ACCOUNT_KIND_BY_TYPE.keys()) != set(AccountType):
    _missing = set(AccountType) - set(ACCOUNT_KIND_BY_TYPE.keys())
    raise RuntimeError(f"ACCOUNT_KIND_BY_TYPE is missing entries for: {_missing}")


# --- Categories ---

class CategoryKind(enum.StrEnum):
    """Category direction used for transaction classification"""

    EXPENSE = "expense"
    INCOME = "income"
    TRANSFER = "transfer"


# --- Budgets ---

class RecurrenceFreq(enum.StrEnum):
    """Budget recurrence frequency values"""

    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


# --- Permissions ---

class PermissionLevel(enum.StrEnum):
    """Shared access level values"""

    READ = "read"
    WRITE = "write"
    ADMIN = "admin"
