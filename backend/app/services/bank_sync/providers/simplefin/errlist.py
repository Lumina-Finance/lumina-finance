"""Turning the problems a SimpleFIN account set reports into the contract's typed failures

Each errlist code has a prefix: gen for the whole request, con for a bank login and act for an
account, and an entry may name the login or account it affects. A message SimpleFIN sends is meant
for the user, so it becomes the failure's reason
"""

import re
from collections.abc import Sequence

from app.services.bank_sync.providers.contract import ExternalAccount, FetchResult, ProviderError, ProviderErrorKind
from app.services.bank_sync.providers.simplefin.account_set import AccountSet, Problem, is_possibly_cut_off

CREDENTIAL_REJECTED_MESSAGE = "SimpleFIN Bridge rejected the stored access credential"
RATE_LIMITED_MESSAGE = "SimpleFIN Bridge asked Lumina Finance to make fewer requests"
_BANK_LOGIN_MESSAGE = "SimpleFIN Bridge says your bank needs you to sign in again"
_REPORTED_MESSAGE = "SimpleFIN Bridge reported a problem"
_MISSING_ACCOUNT_MESSAGE = "SimpleFIN Bridge didn't return this account"

# The reason for a problem SimpleFIN sends without a message
_FALLBACK_REASONS = {
    ProviderErrorKind.CREDENTIAL_REJECTED: CREDENTIAL_REJECTED_MESSAGE,
    ProviderErrorKind.BANK_LOGIN_NEEDED: _BANK_LOGIN_MESSAGE,
    ProviderErrorKind.RATE_LIMITED: RATE_LIMITED_MESSAGE,
    ProviderErrorKind.TEMPORARY: _REPORTED_MESSAGE,
    ProviderErrorKind.UNKNOWN: _REPORTED_MESSAGE,
}

# When several failures affect one request, login or account, the first of these wins
_PRECEDENCE = (
    ProviderErrorKind.CREDENTIAL_REJECTED,
    ProviderErrorKind.BANK_LOGIN_NEEDED,
    ProviderErrorKind.RATE_LIMITED,
    ProviderErrorKind.TEMPORARY,
    ProviderErrorKind.UNKNOWN,
)

# How SimpleFIN Bridge words a warning that its request quota is spent, in a general errlist entry
# or the older errors list. Unverified against real SimpleFIN Bridge data
_QUOTA_WARNING = re.compile(r"fewer requests|refresh limit|rate[ -]?limit|too many requests", re.IGNORECASE)

# SimpleFIN's demo Bridge sends this as gen.api beside the whole history when a request spans more
# than 45 days, so beside data it is a note and not a failure. A refusal that comes back without
# accounts still fails
_RANGE_NOTE = re.compile(r"exceeds recommended range|range.{0,40}(?:days|dates?)|(?:days|dates?).{0,40}range", re.IGNORECASE)


def fetch_result(
    account_set: AccountSet,
    accounts: tuple[ExternalAccount, ...],
    *,
    requested_account_ids: Sequence[str] = (),
) -> FetchResult:
    """Combine the accounts read from a response with the problems it reports

    Args:
        account_set: The parsed response
        accounts: Its accounts, already normalized
        requested_account_ids: The accounts a fetch asked for, each failing when the response
            leaves it out without saying why

    Returns:
        The result, failing the whole request when a problem affects every account in it
    """
    has_data = bool(account_set.accounts)
    request_errors: list[ProviderError] = []
    login_errors: dict[str, ProviderError] = {}
    account_errors: dict[str, ProviderError] = {}
    warnings: list[ProviderError] = []

    # The request errors that refuse the dates asked for, rather than saying the Bridge is down
    refusals: list[ProviderError] = []

    for problem in account_set.errlist:
        kind, is_warning = _classify(problem, has_data=has_data)
        error = ProviderError(kind, problem.msg.strip() or _FALLBACK_REASONS[kind])
        names_range = problem.code == "gen.api" and _RANGE_NOTE.search(problem.msg)
        if kind is ProviderErrorKind.UNKNOWN and (problem.code.startswith("act.") or names_range):
            refusals.append(error)
        if is_warning:
            warnings.append(error)
        elif kind is ProviderErrorKind.CREDENTIAL_REJECTED:
            request_errors.append(error)
        elif problem.account_id and kind is not ProviderErrorKind.BANK_LOGIN_NEEDED:
            _keep_most_serious(account_errors, problem.account_id, error)
        elif problem.conn_id:
            _keep_most_serious(login_errors, problem.conn_id, error)
        else:
            request_errors.append(error)

    # The older errors list names no code, login or account, and needn't word a problem as errlist
    # does. A quota warning there is always recognised, since it may be the only place a server
    # says so, and another request could get the token disabled. Any other message is read only
    # from a server that sends no errlist, and counts like an unknown general code: a warning beside
    # data that keeps any bank account it leaves out from being read as gone
    for message in account_set.errors:
        text = message.strip()
        if _QUOTA_WARNING.search(text):
            kind = ProviderErrorKind.RATE_LIMITED
        elif text and not account_set.errlist:
            kind = ProviderErrorKind.UNKNOWN
        else:
            continue
        (warnings if has_data else request_errors).append(ProviderError(kind, text))

    if request_errors:
        error = min(request_errors, key=_seriousness)

        # A fetch the Bridge answered with no data and a problem naming the dates, or an account's own,
        # refuses the dates for every account it asked for, so each carries the refusal and the sync can
        # try a shorter window. Any other answer, such as maintenance, is an outage like a Bridge that
        # couldn't be reached
        if requested_account_ids and error in refusals:
            refused = {account_id: error for account_id in requested_account_ids}
            return FetchResult(account_errors={**refused, **account_errors}, login_errors=login_errors, warnings=tuple(warnings))
        return FetchResult(request_error=error, warnings=tuple(warnings))

    returned_ids = {account.external_id for account in accounts}
    for account_id in requested_account_ids:
        if account_id not in returned_ids and account_id not in account_errors:
            account_errors[account_id] = ProviderError(ProviderErrorKind.UNKNOWN, _MISSING_ACCOUNT_MESSAGE)

    return FetchResult(
        accounts=accounts,
        account_errors=account_errors,
        login_errors=login_errors,
        warnings=tuple(warnings),
        possibly_cut_off=is_possibly_cut_off(account_set),
    )


def _classify(problem: Problem, *, has_data: bool) -> tuple[ProviderErrorKind, bool]:
    """Return the failure a problem stands for, and whether it is only a warning beside data kept

    An unknown subcode takes its prefix's meaning, except that an unknown general code beside
    account data is only a warning. A general quota warning beside data is one too
    """
    prefix = problem.code.partition(".")[0]
    if problem.code == "gen.auth":
        return ProviderErrorKind.CREDENTIAL_REJECTED, False
    if prefix == "gen" and _QUOTA_WARNING.search(problem.msg):
        return ProviderErrorKind.RATE_LIMITED, has_data

    # The Bridge reporting its own trouble is an outage, unless it names the dates asked for
    if problem.code == "gen.api":
        if _RANGE_NOTE.search(problem.msg):
            return ProviderErrorKind.UNKNOWN, has_data
        return ProviderErrorKind.TEMPORARY, False
    if prefix == "gen":
        return ProviderErrorKind.UNKNOWN, has_data
    if prefix == "con":
        return ProviderErrorKind.BANK_LOGIN_NEEDED, False
    if prefix == "act":
        return ProviderErrorKind.UNKNOWN, False
    return ProviderErrorKind.UNKNOWN, False


def _seriousness(error: ProviderError) -> int:
    """Return where an error's kind falls in precedence, lowest first"""
    return _PRECEDENCE.index(error.kind)


def _keep_most_serious(errors: dict[str, ProviderError], key: str, error: ProviderError) -> None:
    """Record an error under a key unless a more serious one is already there"""
    if key not in errors or _seriousness(error) < _seriousness(errors[key]):
        errors[key] = error
