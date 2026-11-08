"""Which Lumina accounts can take a bank account

Every screen and request asks this one place, so each rule is checked here: only the user's own
personal accounts that aren't archived or already linked are candidates, and a candidate takes a
bank account only in the same ISO currency, while it isn't linked elsewhere and within the
institution limit
"""

import uuid
from datetime import UTC, datetime

import pytest

from app.models.account import Account
from app.models.bank_connection import BankExternalAccount, BankLinkState, UnavailableReason
from app.models.base import AccountKind, AccountType
from app.models.currency import Currency
from app.models.group import Group, GroupMember
from app.services.bank_sync.availability import (
    InstitutionAllowance,
    find_unavailability,
    list_link_candidates,
)
from tests.routes.support.bank_sync_helpers import (
    _build_account,
    _build_bank_connection,
    _build_bank_link,
    _build_external_account,
    _build_user,
)

_NO_LIMIT = InstitutionAllowance(limit=None, in_use={})


def _bank_account(currency: str = "USD", *, institution_key: str = "harbour") -> BankExternalAccount:
    """Return an unsaved bank account named Rewards Visa in the currency, at the institution"""
    return BankExternalAccount(
        owner_id=uuid.uuid4(),
        connection_id=uuid.uuid4(),
        external_id="ACT-VISA",
        name="Rewards Visa",
        institution_key=institution_key,
        institution_name="Harbour Bank",
        login_key="login-1",
        currency=currency,
        last_seen_at=datetime(2026, 10, 1, tzinfo=UTC),
    )


def _account(name: str, currency: str) -> Account:
    """Return an unsaved personal account in the currency"""
    account = _build_account(uuid.uuid4(), name)
    account.currency = currency
    return account


async def test_link_candidates_are_the_users_own_personal_accounts_not_archived_or_linked(db):
    """Everyday and Travel are candidates, while Household, an archived account, a linked one and another user's aren't"""
    db.add_all(
        [
            Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="USD", name="US Dollar", symbol="$", minor_unit_exponent=2),
            Currency(id="EUR", name="Euro", symbol="€", minor_unit_exponent=2),
        ]
    )
    user = _build_user("candidates@example.com")
    other = _build_user("other@example.com")
    db.add_all([user, other])
    await db.flush()
    group = Group(owner_id=user.id, name="Family")
    db.add(group)
    await db.flush()
    db.add(GroupMember(group_id=group.id, user_id=user.id, is_admin=True))

    everyday = _build_account(user.id, "Everyday")
    everyday.currency = "USD"
    travel = _build_account(user.id, "Travel")
    travel.currency = "EUR"
    archived = _build_account(user.id, "Old Savings")
    archived.currency = "USD"
    archived.is_archived = True
    linked = _build_account(user.id, "Chequing")
    others = _build_account(other.id, "Their Everyday")
    others.currency = "USD"
    household = Account(group_id=group.id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name="Household", currency="USD")
    connection = _build_bank_connection(user.id)
    db.add_all([everyday, travel, archived, linked, others, household, connection])
    await db.flush()
    db.add(_build_bank_link(linked, connection))
    await db.flush()

    candidates = await list_link_candidates(db, user.id)

    assert [account.name for account in candidates] == ["Everyday", "Travel"]


async def test_link_candidates_include_an_account_whose_link_was_unlinked(db):
    """Unlinking frees the account to take a bank account again"""
    db.add(Currency(id="CAD", name="Canadian Dollar", symbol="$", minor_unit_exponent=2))
    user = _build_user("unlinked@example.com")
    db.add(user)
    await db.flush()
    account = _build_account(user.id, "Everyday")
    connection = _build_bank_connection(user.id)
    db.add_all([account, connection])
    await db.flush()
    link = _build_bank_link(account, connection)
    link.state = BankLinkState.UNLINKED
    link.unlinked_at = datetime(2026, 10, 2, tzinfo=UTC)
    db.add_all([_build_external_account(connection), link])
    await db.flush()

    assert [candidate.id for candidate in await list_link_candidates(db, user.id)] == [account.id]


def test_link_eligibility_takes_a_bank_account_in_the_accounts_currency():
    """For the USD Rewards Visa, Everyday in USD can take it and Travel in EUR can't"""
    rewards_visa = _bank_account("USD")

    takes = find_unavailability(rewards_visa, _account("Everyday", "USD"), linked_to=None, allowance=_NO_LIMIT, provider_name="SimpleFIN")
    refused = find_unavailability(rewards_visa, _account("Travel", "EUR"), linked_to=None, allowance=_NO_LIMIT, provider_name="SimpleFIN")

    assert takes is None
    assert refused is not None
    assert (refused.reason, refused.message) == (UnavailableReason.CURRENCY_MISMATCH, "In USD, but Travel is in EUR")


@pytest.mark.parametrize("currency", ["https://www.simplefin.org/currencies/flight-miles", ""], ids=["url", "empty"])
def test_link_eligibility_refuses_a_currency_of_the_providers_own(currency):
    """A bank account in a custom currency is listed but can't be linked to any account"""
    unavailable = find_unavailability(
        _bank_account(currency), _account("Everyday", "USD"), linked_to=None, allowance=_NO_LIMIT, provider_name="SimpleFIN"
    )

    assert unavailable is not None
    assert (unavailable.reason, unavailable.message) == (
        UnavailableReason.CUSTOM_CURRENCY,
        "Uses a currency of its own that Lumina Finance can't track",
    )


def test_link_eligibility_refuses_a_bank_account_already_linked():
    """A bank account feeds one ledger, so once linked to Everyday it can't be linked to Spending too"""
    unavailable = find_unavailability(
        _bank_account("USD"), _account("Spending", "USD"), linked_to="Everyday", allowance=_NO_LIMIT, provider_name="SimpleFIN"
    )

    assert unavailable is not None
    assert (unavailable.reason, unavailable.message) == (UnavailableReason.ALREADY_LINKED, "Already linked to Everyday")


@pytest.mark.parametrize(
    ("in_use", "message"),
    [
        ({"harbour": "Harbour Bank"}, "Would go over your limit of 1 institution for SimpleFIN"),
        ({"harbour": "Harbour Bank", "northgate": "Northgate Credit Union"}, "Would go over your limit of 2 institutions for SimpleFIN"),
    ],
    ids=["one", "several"],
)
def test_link_eligibility_refuses_a_new_institution_past_the_limit(in_use, message):
    """With the limit reached, Lakeshore Trust is refused and another Harbour Bank account isn't"""
    allowance = InstitutionAllowance(limit=len(in_use), in_use=in_use)
    everyday = _account("Everyday", "USD")

    lakeshore = find_unavailability(
        _bank_account(institution_key="lakeshore"), everyday, linked_to=None, allowance=allowance, provider_name="SimpleFIN"
    )
    harbour = find_unavailability(
        _bank_account(institution_key="harbour"), everyday, linked_to=None, allowance=allowance, provider_name="SimpleFIN"
    )

    assert lakeshore is not None
    assert (lakeshore.reason, lakeshore.message) == (UnavailableReason.INSTITUTION_LIMIT, message)
    assert harbour is None


def test_link_eligibility_without_an_institution_limit_takes_any_institution():
    """With no institution limit, any number of institutions can be linked"""
    allowance = InstitutionAllowance(limit=None, in_use={"harbour": "Harbour Bank", "northgate": "Northgate Credit Union"})

    unavailable = find_unavailability(
        _bank_account(institution_key="lakeshore"), _account("Everyday", "USD"), linked_to=None, allowance=allowance, provider_name="SimpleFIN"
    )

    assert unavailable is None
