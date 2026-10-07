"""Import run lifetimes, shared by the import services and the database helper that prunes runs"""

from datetime import timedelta

# Both are written into the pruning helper's body when a migration creates it, so changing either
# needs a migration that calls create_helper_functions, or the database keeps the old lifetime

# How long a run can go uncommitted before it counts as abandoned. An upload stages and commits
# within minutes, so a run this old is one nobody is coming back to, and saving it now would land
# an import its user may already have given up on and brought in again
ABANDONED_RUN_AGE = timedelta(hours=24)

# How long after an import is saved it can be undone. Its run, and the link from each transaction it
# wrote, is only kept for that, so it goes once this passes
IMPORT_UNDO_WINDOW = timedelta(hours=24)
