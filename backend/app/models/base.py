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


class AccountType(enum.StrEnum):
    CHECKING = "checking"
    SAVINGS = "savings"
    CREDIT_CARD = "credit_card"
    CASH = "cash"
    INVESTMENT = "investment"


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
