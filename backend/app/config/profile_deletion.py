"""Profile deletion settings that are fixed in code"""

from datetime import timedelta

# How long before a waiting profile's deletion its owner is reminded, and the shortest time between the
# request and the deletion that earns a reminder, since a request made inside this time has just
# been told the date. Copied into the function that lists the reminders due, so a change reaches a
# database only through a migration that recreates the helpers
DELETION_REMINDER_LEAD = timedelta(days=3)
