"""Firefly III export vocabulary shared by the importer modules"""

# Journal types as they appear in the Firefly III transactions export
FIREFLY_TYPE_WITHDRAWAL = "withdrawal"
FIREFLY_TYPE_DEPOSIT = "deposit"
FIREFLY_TYPE_TRANSFER = "transfer"
FIREFLY_TYPE_OPENING_BALANCE = "opening balance"
FIREFLY_TYPE_RECONCILIATION = "reconciliation"

# Firefly III account types that map to Lumina accounts rather than
# merchants, matched case-insensitively against source and destination types
FIREFLY_TRACKED_ACCOUNT_TYPES = frozenset({
    "asset account",
    "loan",
    "debt",
    "mortgage",
})

# Category mapping source used for rows that carry no category, the frontend
# includes a mapping under this name whenever such rows exist
FIREFLY_NO_CATEGORY_SOURCE = "(no category)"

# System category names used for rows that move money between two imported
# accounts instead of categorized spending or income
SYSTEM_TRANSFER_CATEGORY_NAME = "Transfer"
SYSTEM_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
