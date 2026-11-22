"""The points code outside the app may build on

Every name listed here is supported: it keeps its name and call signature unless a change to this
list says otherwise, and tests/test_extension.py fails when one moves. Nothing else in the app is
supported, so code outside it takes these from this module and imports no other app module

Importing this module loads nothing else. A name is imported from its home module when it is first
asked for, since some homes read the signing keys or the database password as they load
"""

# Imported under private names, so the module offers no public name besides the points and their table
import importlib as _importlib
from typing import Any as _Any

# Each supported name and where it lives, as "module:attribute"
SUPPORTED_POINTS: dict[str, str] = {
    "app": "app.main:app",
    "observe_requests": "app.request_hook:observe_requests",
    "RequestRecord": "app.request_hook:RequestRecord",
    "observe_email_changes": "app.email_change_hook:observe_email_changes",
    "EmailChange": "app.email_change_hook:EmailChange",
    "get_authenticated_user": "app.dependencies:get_authenticated_user",
    "set_email_sender": "app.services.email.contract:set_email_sender",
    "EmailSender": "app.services.email.contract:EmailSender",
    "RenderedEmail": "app.services.email.contract:RenderedEmail",
    "set_service_name": "app.services.service_name:set_service_name",
    "set_signup_check": "app.signup_check_hook:set_signup_check",
    "SignupAttempt": "app.signup_check_hook:SignupAttempt",
    "verify_ready_to_sync": "app.services.bank_sync.worker:verify_ready_to_sync",
    "enqueue_due_work": "app.services.bank_sync.worker:enqueue_due_work",
    "run_jobs": "app.services.bank_sync.worker:run_jobs",
    "run_worker": "app.services.bank_sync.worker:run_worker",
    "prune_expired_records": "app.services.maintenance.expired_records:prune_expired_records",
    "run_migrate": "app.db.jobs:run_migrate",
    "verify_app_role_is_unprivileged": "app.database:verify_app_role_is_unprivileged",
    "verify_database_keys": "app.db.database_keys:verify_database_keys",
    "sync_sign_in_providers": "app.startup:sync_sign_in_providers",
    "run_startup_checks": "app.services.bank_sync.providers.registry:run_startup_checks",
    "use_valkey": "app.valkey_store:use_valkey",
    "run_cleanup_timer": "app.services.maintenance.expired_records:run_cleanup_timer",
    "set_cleanup_timer_enabled": "app.services.maintenance.expired_records:set_cleanup_timer_enabled",
}

__all__ = list(SUPPORTED_POINTS)


def __getattr__(name: str) -> _Any:
    """Import a supported point from its home when it is first asked for

    Raises:
        AttributeError: The name is not a supported point
    """
    location = SUPPORTED_POINTS.get(name)
    if location is None:
        raise AttributeError(f"module {__name__!r} has no supported point {name!r}")
    module_name, attribute = location.split(":")
    return getattr(_importlib.import_module(module_name), attribute)


def __dir__() -> list[str]:
    """List the supported points, so a completion offers nothing else"""
    return sorted(SUPPORTED_POINTS)
