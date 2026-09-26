"""Journal vocabulary shared by the importer modules"""

from app.models.import_run import ImportRunSource

# Journal types as the import screen sends them, lowercased whichever export they came from
JOURNAL_TYPE_WITHDRAWAL = "withdrawal"
JOURNAL_TYPE_DEPOSIT = "deposit"
JOURNAL_TYPE_OPENING_BALANCE = "opening balance"
JOURNAL_TYPE_RECONCILIATION = "reconciliation"

# Category mapping source used for rows that carry no category, the frontend
# includes a mapping under this name whenever such rows exist
JOURNAL_NO_CATEGORY_SOURCE = "(no category)"

# Client-facing reason for rows that fail conversion in a way no specific
# refusal rule anticipated, the specifics go to the server log instead
JOURNAL_GENERIC_REFUSAL_REASON = "Row could not be converted"

# How a refusal names a row, by the importer that opened its run, so the reader can find the row
# in the export it came from
JOURNAL_ROW_LABELS = {
    ImportRunSource.FIREFLY: "Firefly III journal",
    ImportRunSource.ACTUAL_BUDGET: "Actual Budget transaction",
}

# Runs the journal endpoints take, which are the importers a refusal knows how to name a row for
JOURNAL_RUN_SOURCES = frozenset(JOURNAL_ROW_LABELS)

# System category names used for rows that move money between two imported
# accounts instead of categorized spending or income
SYSTEM_TRANSFER_CATEGORY_NAME = "Transfer"
SYSTEM_BALANCE_ADJUSTMENT_CATEGORY_NAME = "Balance Adjustment"
