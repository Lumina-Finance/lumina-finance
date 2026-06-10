"""Account permission route module"""

from app.routes.accounts.permissions.router import (
    grant_account_permission,
    list_account_permissions,
    revoke_account_permission,
    router,
)

__all__ = [
    "grant_account_permission",
    "list_account_permissions",
    "revoke_account_permission",
    "router",
]
