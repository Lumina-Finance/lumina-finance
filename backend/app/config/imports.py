"""Import settings: run lifetimes, shared with the database helper that prunes runs, and the bank transaction hash key"""

import os
from datetime import timedelta

# The key OFX imports' bank transaction hashes are made with, as set in the environment, or None.
# app.bank_transaction_key falls back to the file persisted on the data volume, so None alone does
# not mean there is no key. A trailing newline from an env file or a mounted secret is not part of it
BANK_TRANSACTION_HASH_KEY_ENV_VAR = "BANK_TRANSACTION_HASH_KEY"
BANK_TRANSACTION_HASH_KEY = os.getenv(BANK_TRANSACTION_HASH_KEY_ENV_VAR, "").strip() or None

# Both are written into the pruning helper's body when a migration creates it, so changing either
# needs a migration that calls create_helper_functions, or the database keeps the old lifetime

# How long a run can go uncommitted before it counts as abandoned. An upload stages and commits
# within minutes, so a run this old is one nobody is coming back to, and saving it now would land
# an import its user may already have given up on and brought in again
ABANDONED_RUN_AGE = timedelta(hours=24)

# How long after an import is saved it can be undone. Its run, and the link from each transaction it
# wrote, is only kept for that, so it goes once this passes
IMPORT_UNDO_WINDOW = timedelta(hours=24)
