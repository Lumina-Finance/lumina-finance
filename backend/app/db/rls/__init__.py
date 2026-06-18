"""Row-level security schema setup

apply_rls and revoke_rls compose the helper functions and the table policies into the
single pair the migration and the test harness call
"""

from sqlalchemy import Connection

from app.db.rls.functions import create_helper_functions, drop_helper_functions
from app.db.rls.policies import AUTH_TABLES, GLOBAL_READ_TABLES, apply_policies, drop_policies

__all__ = ["AUTH_TABLES", "GLOBAL_READ_TABLES", "apply_rls", "revoke_rls"]


def apply_rls(connection: Connection) -> None:
    """Create the RLS helpers, enable the policies, and grant the app role access"""
    create_helper_functions(connection)
    apply_policies(connection)


def revoke_rls(connection: Connection) -> None:
    """Drop every policy, disable row-level security, and remove the helpers"""
    drop_policies(connection)
    drop_helper_functions(connection)
