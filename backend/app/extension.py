"""The points code outside the app may build on

Every name listed here is supported: it keeps its name and call signature unless a change to this
list says otherwise, and tests/test_extension.py fails when one moves. Nothing else in the app is
supported, so code outside it takes these from this module and imports no other app module

Importing this module loads nothing else. A name is imported from its home module when it is first
asked for, since some homes read the signing keys or the database password as they load
"""

import importlib
from typing import Any

# Each supported name and where it lives, as "module:attribute"
SUPPORTED_POINTS: dict[str, str] = {
    "app": "app.main:app",
    "observe_requests": "app.request_hook:observe_requests",
    "RequestRecord": "app.request_hook:RequestRecord",
    "get_authenticated_user": "app.dependencies:get_authenticated_user",
    "set_email_sender": "app.services.email.contract:set_email_sender",
    "EmailSender": "app.services.email.contract:EmailSender",
    "RenderedEmail": "app.services.email.contract:RenderedEmail",
    "enqueue_due_work": "app.services.bank_sync.worker:enqueue_due_work",
    "run_jobs": "app.services.bank_sync.worker:run_jobs",
    "prune_expired_records": "app.services.maintenance.expired_records:prune_expired_records",
    "run_bootstrap": "app.db.jobs:run_bootstrap",
    "run_migrate": "app.db.jobs:run_migrate",
}

__all__ = list(SUPPORTED_POINTS)


def __getattr__(name: str) -> Any:
    """Import a supported point from its home when it is first asked for

    Raises:
        AttributeError: The name is not a supported point
    """
    location = SUPPORTED_POINTS.get(name)
    if location is None:
        raise AttributeError(f"module {__name__!r} has no supported point {name!r}")
    module_name, attribute = location.split(":")
    return getattr(importlib.import_module(module_name), attribute)


def __dir__() -> list[str]:
    """List the supported points, so a completion offers nothing else"""
    return sorted(SUPPORTED_POINTS)
