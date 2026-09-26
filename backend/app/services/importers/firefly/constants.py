"""Firefly III export vocabulary shared by the importer modules"""

# Journal types as the import screen sends them, lowercased from the Firefly III export
FIREFLY_TYPE_WITHDRAWAL = "withdrawal"
FIREFLY_TYPE_DEPOSIT = "deposit"
FIREFLY_TYPE_OPENING_BALANCE = "opening balance"
FIREFLY_TYPE_RECONCILIATION = "reconciliation"

# Category mapping source used for rows that carry no category, the frontend
# includes a mapping under this name whenever such rows exist
FIREFLY_NO_CATEGORY_SOURCE = "(no category)"

# Client-facing reason for rows that fail conversion in a way no specific
# refusal rule anticipated, the specifics go to the server log instead
FIREFLY_GENERIC_REFUSAL_REASON = "Row could not be converted"

# System category names used for rows that move money between two imported
# accounts instead of categorized spending or income
SYSTEM_TRANSFER_CATEGORY_NAME = "Transfer"
SYSTEM_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
