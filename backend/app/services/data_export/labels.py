"""The words the app's screens use for the values a file holds, so a cell reads as the screen does

Each mapping mirrors the frontend source named above it. A value with no entry is written as stored,
so a value added later still reaches the file until its screen word is copied here
"""

from collections.abc import Mapping
from typing import Any

# frontend/src/pages/accounts/detail/constants/accountDetail.ts, ACCOUNT_KIND_LABEL
ACCOUNT_KINDS = {"asset": "Asset", "revolving": "Revolving credit", "amortizing": "Amortizing debt"}

# frontend/src/pages/accounts/utils/filters.ts, the account type options
ACCOUNT_TYPES = {
    "checking": "Checking",
    "savings": "Savings",
    "term_deposit": "Term deposit",
    "cash": "Cash",
    "investment": "Investment",
    "credit_card": "Credit card",
    "line_of_credit": "Line of credit",
    "heloc": "HELOC",
    "loan": "Loan",
    "mortgage": "Mortgage",
}

# frontend/src/pages/imports/constants.ts, KIND_LABELS
CATEGORY_KINDS = {"expense": "Expense", "income": "Income", "transfer": "Transfer"}

# frontend/src/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/constants.ts, TAX_TREATMENT_OPTIONS
TAX_TREATMENTS = {"tax_free": "Exempt", "tax_deferred": "Deferred", "tax_assisted": "Assisted"}

# frontend/src/pages/budgets/constants.ts, RECURRENCE_OPTIONS
RECURRENCE_FREQUENCIES = {"weekly": "Weekly", "monthly": "Monthly", "yearly": "Yearly"}

# frontend/src/components/date-field/CalendarPopover.tsx lists the months by name. Weeks run Monday to
# Sunday everywhere in the product, as in frontend/src/utils/date.ts, and the budget stores Monday as 0
WEEKDAYS = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}
MONTHS = {
    1: "January",
    2: "February",
    3: "March",
    4: "April",
    5: "May",
    6: "June",
    7: "July",
    8: "August",
    9: "September",
    10: "October",
    11: "November",
    12: "December",
}

# frontend/src/pages/settings/formatOptions.ts, DATE_FORMAT_DESCRIPTIONS
DATE_FORMATS = {"month-day-year": "Month, day, year", "day-month-year": "Day, month, year", "iso": "Year, month, day (ISO 8601)"}

# frontend/src/pages/insights/components/RelativeRangeBuilder.tsx, QUALIFIER_OPTIONS. Units show as stored,
# as in getRelativeRangeLabel in frontend/src/pages/insights/utils/range.ts
INSIGHTS_QUALIFIERS = {"this": "This", "last": "Last", "past": "Past"}

# frontend/src/pages/imports/utils/lastImport.ts, IMPORT_SOURCE_LABELS
IMPORT_SOURCES = {
    "generic": "CSV",
    "firefly": "Firefly III",
    "actual_budget": "Actual Budget",
    "ofx": "OFX/QFX",
    "qif": "Quicken 3.0 (QIF)",
}

# Choose bank account is the word in frontend/src/pages/accounts/detail/components/bank-link/status.ts and
# Unlinked the word of the toast in frontend/src/pages/accounts/detail/components/bank-link/UnlinkModal.tsx.
# Linked is the export's own word: no screen shows it, since the account's page shows how recently a live
# link synced instead
BANK_LINK_STATES = {"active": "Linked", "choose_account": "Choose bank account", "unlinked": "Unlinked"}

# Needs review is the marker in frontend/src/components/transactions/BankMarker.tsx, and Dismissed the
# word of the bulk dismissal in frontend/src/components/transactions/bulk-edit/reviewSelection.ts.
# Accepted is the export's own word: no screen shows a stored item's status, only the ledger row it became
BANK_REVIEW_STATUSES = {"awaiting_review": "Needs review", "accepted": "Accepted", "dismissed": "Dismissed"}

# frontend/src/utils/transfers.ts, OUTSIDE_ACCOUNT_LABEL
OUTSIDE_ACCOUNT = "Outside this app"


def label(words: Mapping[Any, str], value: Any) -> Any:
    """Return the screen's word for a stored value, or the value itself when none is known"""
    return words.get(value, value)
