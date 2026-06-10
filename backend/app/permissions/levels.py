"""Permission level comparison helpers"""

from app.models.base import PermissionLevel

_LEVEL_RANK = {
    PermissionLevel.READ: 0,
    PermissionLevel.WRITE: 1,
    PermissionLevel.ADMIN: 2,
}


def is_permission_level_at_least(granted_level: PermissionLevel, required_level: PermissionLevel) -> bool:
    """Return whether a granted permission level satisfies a required level

    Args:
        granted_level: Permission level assigned to the user
        required_level: Minimum permission level required by the operation

    Returns:
        Whether the granted level is equal to or higher than the required level
    """
    is_sufficient = _LEVEL_RANK[granted_level] >= _LEVEL_RANK[required_level]
    return is_sufficient
