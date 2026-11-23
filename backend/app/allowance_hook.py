"""A supported point to check what a user may add or use

Code built on the app installs one check with set_allowance_check. Before a user adds a record of a
kind the check is asked about, uses a feature it is asked about, or makes a change it is asked about,
the app asks the check. With no check installed, every user may do everything
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum


class AllowanceKind(StrEnum):
    """What a check is asked about

    A record kind is asked before one more record is added, and a feature kind before the feature is
    used. A budget is the set-up budget, never one of its periods, and every record kind counts only
    what the user owns alone, since a record owned through a group is never asked about

    A change kind is asked before the change is saved, once it has been validated, and is neither a
    record nor a feature
    """

    ACCOUNT = "account"
    BUDGET = "budget"
    CATEGORY = "category"
    TAG = "tag"
    MERCHANT = "merchant"
    TAX_ADVANTAGED_CATEGORY = "tax_advantaged_category"

    # Every yearly limit under the user's tax-advantaged categories, counted together
    TAX_ADVANTAGED_CATEGORY_LIMIT = "tax_advantaged_category_limit"
    SAVED_INSIGHTS_RANGE = "saved_insights_range"
    BANK_CONNECTION = "bank_connection"

    # Linking bank accounts and every sync of them, scheduled or asked for
    BANK_SYNC = "bank_sync"

    # The insights figures and the saved ranges beside them
    INSIGHTS = "insights"

    # Adding an account, budget or tax-advantaged category in a currency other than the user's main
    # one. Asked as a feature. A no also leaves amounts in other currencies out of the converted totals
    # the server computes, and its sentence shows on those totals and on each transaction row left out
    FOREIGN_CURRENCIES = "foreign_currencies"

    # Changing the user's main currency, asked after the change is validated and before it is saved.
    # A change kind, so it is asked with held None and adding 0
    MAIN_CURRENCY_CHANGE = "main_currency_change"


@dataclass(frozen=True)
class AllowanceRequest:
    """What a check is told about what a user is about to do

    Attributes:
        user_id: The user doing it
        kind: What they are about to add or use
        held: How many records of the kind the user owns alone now, or None for a feature or a change
        adding: How many records the user is about to add at once, such as the merchants of an
            import, or 0 for a feature or a change
    """

    user_id: uuid.UUID
    kind: AllowanceKind
    held: int | None
    adding: int


@dataclass(frozen=True)
class Refusal:
    """A check's no

    Attributes:
        reason: The sentence the user reads. The app shows it as it is
    """

    reason: str


AllowanceCheck = Callable[[AllowanceRequest], Awaitable[Refusal | None]]

_check: AllowanceCheck | None = None


def set_allowance_check(check: AllowanceCheck) -> None:
    """Install the check asked before a user adds a record or uses a feature, replacing any installed before

    Args:
        check: Async function taking the request and returning None to allow it or a Refusal to
            refuse it. A refusal answers the user's request with 403 and the reason, and nothing is
            added. An error it raises fails the request as any server fault does, and nothing is
            added. It runs inside the request, so it must return quickly and put its own time
            limit on anything it waits for
    """
    global _check
    _check = check


def is_allowance_check_installed() -> bool:
    """Return whether a check is installed, so a caller can skip the work of building a request for none"""
    return _check is not None


async def find_refusal(request: AllowanceRequest) -> Refusal | None:
    """Ask the installed check, and return its refusal, or None when it allows or none is installed

    Args:
        request: What the user is about to do

    Raises:
        TypeError: The check answered with something other than None or a Refusal
    """
    check = _check
    if check is None:
        return None

    # An error the check raises is left to propagate, so a check that fails never lets anyone in
    answer = await check(request)
    if answer is not None and not isinstance(answer, Refusal):
        raise TypeError(f"The allowance check answered with a value of type {type(answer).__name__}, not None or a Refusal")
    return answer
