import enum

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""

    pass


# --- Auth ---

class AuthProvider(enum.StrEnum):
    PASSWORD = "password"  # noqa: S105 — enum value, not a hardcoded secret


# --- Institutions ---

class InstitutionStatus(enum.StrEnum):
    CANONICAL = "canonical"
    PENDING = "pending"


# --- Accounts ---

class TaxTreatment(enum.StrEnum):
    TAXABLE = "taxable"          # e.g., checking, savings, investment
    TAX_FREE = "tax_free"        # e.g., TFSA, Roth IRA, FHSA
    TAX_DEFERRED = "tax_deferred"  # e.g., RRSP, 401k, traditional IRA
    TAX_ASSISTED = "tax_assisted"  # e.g., RESP — grants/matching


class AccountKind(enum.StrEnum):
    ASSET = "asset"
    LIABILITY = "liability"


class AccountType(enum.StrEnum):
    # Asset subtypes
    CHECKING = "checking"
    SAVINGS = "savings"
    TERM_DEPOSIT = "term_deposit"
    CASH = "cash"
    INVESTMENT = "investment"
    # Liability subtypes
    CREDIT_CARD = "credit_card"
    LINE_OF_CREDIT = "line_of_credit"
    HELOC = "heloc"
    LOAN = "loan"
    MORTGAGE = "mortgage"


# Source of truth for which AccountType belongs to which AccountKind. The Account.account_kind
# column on each row is validated against this mapping at create/update time so the two stay in sync.
ACCOUNT_KIND_BY_TYPE: dict[AccountType, AccountKind] = {
    AccountType.CHECKING: AccountKind.ASSET,
    AccountType.SAVINGS: AccountKind.ASSET,
    AccountType.TERM_DEPOSIT: AccountKind.ASSET,
    AccountType.CASH: AccountKind.ASSET,
    AccountType.INVESTMENT: AccountKind.ASSET,
    AccountType.CREDIT_CARD: AccountKind.LIABILITY,
    AccountType.LINE_OF_CREDIT: AccountKind.LIABILITY,
    AccountType.HELOC: AccountKind.LIABILITY,
    AccountType.LOAN: AccountKind.LIABILITY,
    AccountType.MORTGAGE: AccountKind.LIABILITY,
}

# Fail-fast: every AccountType variant must be mapped, so adding a variant without mapping it crashes at import
if set(ACCOUNT_KIND_BY_TYPE.keys()) != set(AccountType):
    _missing = set(AccountType) - set(ACCOUNT_KIND_BY_TYPE.keys())
    raise RuntimeError(f"ACCOUNT_KIND_BY_TYPE is missing entries for: {_missing}")


# --- Categories ---

class CategoryKind(enum.StrEnum):
    EXPENSE = "expense"
    INCOME = "income"
    TRANSFER = "transfer"


# --- Budgets ---

class RecurrenceFreq(enum.StrEnum):
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


# --- Permissions ---

class PermissionLevel(enum.StrEnum):
    READ = "read"
    WRITE = "write"
    ADMIN = "admin"
