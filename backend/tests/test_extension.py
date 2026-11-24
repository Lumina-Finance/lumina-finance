"""Supported points tests: a rename or a changed call signature of a point fails here, naming the point

Code outside the app builds on the names in app.extension, so moving one is a decision to make in
the same change as its entry in the table below, never a side effect of a refactor
"""

import inspect
import os
import re
import subprocess
import sys
import typing
from pathlib import Path

import pytest
from fastapi import FastAPI

from app import extension
from app.extension import SUPPORTED_POINTS

BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]


class _Text(str):
    """Text that shows as itself in a signature, where a plain string would show quoted"""

    __repr__ = str.__str__


def _type_text(annotation) -> str:
    """Name an annotation without its modules or its Annotated metadata, so a library moving a class changes nothing"""
    if typing.get_origin(annotation) is typing.Annotated:
        annotation = typing.get_args(annotation)[0]
    return re.sub(r"\b[a-z_][a-z0-9_]*\.", "", inspect.formatannotation(annotation))


def _describe(label: str, callable_) -> str:
    """Write a callable as one line, such as `async run_jobs(max_jobs: int) -> int`, hiding default values"""
    signature = inspect.signature(callable_)
    parameters = [
        parameter.replace(
            annotation=_Text(_type_text(parameter.annotation)) if parameter.annotation is not parameter.empty else parameter.empty,
            default=_Text("...") if parameter.default is not parameter.empty else parameter.empty,
        )
        for parameter in signature.parameters.values()
    ]
    # A class's signature is its constructor's, whose None return says nothing a caller relies on
    has_return = signature.return_annotation is not signature.empty and not inspect.isclass(callable_)
    returns = _Text(_type_text(signature.return_annotation)) if has_return else signature.empty
    prefix = "async " if inspect.iscoroutinefunction(callable_) else ""
    return f"{prefix}{label}{signature.replace(parameters=parameters, return_annotation=returns)}"


# What each point promises to code calling it. A line changes only together with a change to the
# design page that describes the point
EXPECTED_SHAPES: dict[str, str] = {
    "observe_requests": "observe_requests(observer: Callable[[RequestRecord], None]) -> None",
    "RequestRecord": "RequestRecord(scope: Mapping[str, Any], method: str, route: str, status: int, duration_seconds: float)",
    "observe_email_changes": "observe_email_changes(observer: Callable[[EmailChange], None]) -> None",
    "EmailChange": "EmailChange(user_id: UUID, old_email: str, new_email: str)",
    "observe_profile_deletions": "observe_profile_deletions(observer: Callable[[ProfileDeletion], None]) -> None",
    "ProfileDeletion": "ProfileDeletion(user_id: UUID, deleted_at: datetime)",
    "list_users": "async list_users(after: UUID | None = ..., session_factory: async_sessionmaker[AsyncSession] = ...) -> list[UserSummary]",
    "UserSummary": "UserSummary(user_id: UUID, email: str, signed_up_at: datetime, last_signed_in_at: datetime | None)",
    "get_authenticated_user": "async get_authenticated_user(credentials: HTTPAuthorizationCredentials, db: AsyncSession) -> User",
    "set_email_sender": "set_email_sender(sender: EmailSender) -> None",
    "EmailSender": "async EmailSender.send(self, recipient: str, message: RenderedEmail) -> None",
    "RenderedEmail": "RenderedEmail(subject: str, text_body: str, html_body: str | None = ...)",
    "set_service_name": "set_service_name(name: str) -> None",
    "set_signup_check": "set_signup_check(check: Callable[[SignupAttempt], Awaitable[bool]]) -> None",
    "SignupAttempt": "SignupAttempt(email: str)",
    "set_allowance_check": "set_allowance_check(check: Callable[[AllowanceRequest], Awaitable[Refusal | None]]) -> None",
    "AllowanceRequest": "AllowanceRequest(user_id: UUID, kind: AllowanceKind, held: int | None, adding: int)",
    "Refusal": "Refusal(reason: str)",
    "verify_ready_to_sync": "async verify_ready_to_sync() -> None",
    "enqueue_due_work": "async enqueue_due_work() -> None",
    "run_jobs": "async run_jobs(max_jobs: int, deadline: datetime | None = ...) -> int",
    "run_worker": "async run_worker() -> None",
    "prune_expired_records": "async prune_expired_records(session_factory: async_sessionmaker[AsyncSession] = ...) -> None",
    "run_migrate": "async run_migrate() -> None",
    "verify_app_role_is_unprivileged": "async verify_app_role_is_unprivileged() -> None",
    "verify_database_keys": "async verify_database_keys() -> None",
    "sync_sign_in_providers": "async sync_sign_in_providers() -> None",
    "run_startup_checks": "run_startup_checks() -> None",
    "use_valkey": "use_valkey(store: ValkeyStore | None = ...) -> AsyncIterator[ValkeyStore | None]",
    "run_cleanup_timer": "run_cleanup_timer() -> AsyncIterator[None]",
    "set_cleanup_timer_enabled": "set_cleanup_timer_enabled(enabled: bool) -> None",
    "run_in_app_saves": "run_in_app_saves() -> AsyncIterator[None]",
    "set_import_save_starter": "set_import_save_starter(starter: Callable[[UUID, UUID], Awaitable[None]]) -> None",
    "run_import_save": "async run_import_save(run_id: UUID, owner_id: UUID, session_factory: async_sessionmaker[AsyncSession] = ...) -> None",
}


# What a supported enumeration promises: each member's name and value
# Code built on the app matches on them, so a member is added here with its entry in the design page and never renamed
EXPECTED_MEMBERS: dict[str, dict[str, str]] = {
    "AllowanceKind": {
        "ACCOUNT": "account",
        "BUDGET": "budget",
        "CATEGORY": "category",
        "TAG": "tag",
        "MERCHANT": "merchant",
        "TAX_ADVANTAGED_CATEGORY": "tax_advantaged_category",
        "TAX_ADVANTAGED_CATEGORY_LIMIT": "tax_advantaged_category_limit",
        "SAVED_INSIGHTS_RANGE": "saved_insights_range",
        "BANK_CONNECTION": "bank_connection",
        "BANK_SYNC": "bank_sync",
        "INSIGHTS": "insights",
        "FOREIGN_CURRENCIES": "foreign_currencies",
        "MAIN_CURRENCY_CHANGE": "main_currency_change",
    },
}


def test_every_supported_point_has_its_shape_pinned():
    """Listing a point in the module means writing down the shape it promises, and the reverse"""
    assert set(SUPPORTED_POINTS) == {"app", *EXPECTED_SHAPES, *EXPECTED_MEMBERS}


@pytest.mark.parametrize("name", sorted(EXPECTED_MEMBERS))
def test_a_supported_enumeration_keeps_its_members(name):
    """Renaming a member, changing its value, or dropping one fails naming the enumeration"""
    members = {member.name: member.value for member in getattr(extension, name)}

    assert members == EXPECTED_MEMBERS[name], f"supported point {name} changed its members"


@pytest.mark.parametrize("name", sorted(EXPECTED_SHAPES))
def test_a_point_keeps_its_name_and_call_signature(name):
    """Renaming a point, or changing its arguments, their kinds, their types or which have defaults, fails naming it"""
    point = getattr(extension, name)
    described = _describe("EmailSender.send" if name == "EmailSender" else name, point.send if name == "EmailSender" else point)

    assert described == EXPECTED_SHAPES[name], f"supported point {name} changed shape"


def test_the_email_sender_point_stays_a_protocol_any_class_can_satisfy():
    """A sender is any object with the right send method, so it never has to inherit from the app's class"""
    assert typing.is_protocol(extension.EmailSender), "supported point EmailSender is no longer a protocol"


def test_the_app_point_is_an_application_taking_dependency_overrides():
    """Code outside the app serves this object and replaces its dependencies through the override table"""
    assert isinstance(extension.app, FastAPI), "supported point app is no longer a FastAPI application"


def test_a_name_that_is_not_a_point_is_not_there():
    """Only the listed points and their table are reachable through the module, and another name of the app is refused"""
    public_names = {name for name in vars(extension) if not name.startswith("_")}

    assert public_names == {"SUPPORTED_POINTS"}, "the module offers a public name that is not a point"
    with pytest.raises(AttributeError):
        extension.get_db  # noqa: B018


# Run in a fresh interpreter, since this test process read the app long ago. It prints the installed
# sender's class name after the app is read, with or without installing its own sender first
READ_APP_PROGRAM = """
import sys
import app.extension as extension
from app.services.email.contract import get_email_sender

class OwnSender:
    async def send(self, recipient, message):
        pass

if sys.argv[1] == "install":
    extension.set_email_sender(OwnSender())
extension.app
print(type(get_email_sender()).__name__)
"""

# The start-up warning that sign-up and reset links go to the log, said when the logging sender is configured
LOGGING_BACKEND_WARNING_START = "EMAIL_BACKEND is set to logging"


@pytest.mark.parametrize(
    ("installs_first", "installed", "warns"),
    [(True, "OwnSender", False), (False, "LoggingEmailSender", True)],
    ids=["own sender first", "nothing first"],
)
def test_reading_the_app_installs_the_configured_sender_only_when_none_is_installed(installs_first, installed, warns):
    """A sender installed before the app is read stays, so its mail never goes to the log, and none installed gets the configured one"""
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", READ_APP_PROGRAM, "install" if installs_first else "none"],
        cwd=BACKEND_DIRECTORY,
        env={**os.environ, "EMAIL_BACKEND": "logging"},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == installed, "reading the app replaced the installed email sender"
    assert (LOGGING_BACKEND_WARNING_START in result.stderr) is warns, "the logging warning names a sender that is not installed"


def test_importing_the_module_needs_no_settings_and_loads_no_heavy_module():
    """The signing keys and the database password are only read when a point that needs them is asked for"""
    heavy = ("app.dependencies", "app.database", "app.main", "app.startup", "app.config.jwt")
    program = f"import sys, app.extension; print([name for name in {heavy!r} if name in sys.modules])"

    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", program], cwd=BACKEND_DIRECTORY, env={}, capture_output=True, text=True, check=False
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[]"
