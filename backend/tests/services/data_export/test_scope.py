"""The export holds only what the user owns personally, whatever else row-level security lets them read"""

import pytest
from sqlalchemy import select

from app.models.account import Account, TaxAdvantagedCategory
from app.models.base import AccountKind, AccountType, CategoryKind, RecurrenceFreq, TaxTreatment
from app.models.budget import BaseBudget
from app.models.category import Category
from app.models.group import Group
from app.models.merchant import Merchant
from app.models.tag import Tag
from app.services.data_export import scope
from tests.conftest import TestSession
from tests.routes.support.identity_helpers import _seed_users


def _account(owner_id, group_id, name):
    return Account(
        owner_id=owner_id, group_id=group_id, account_kind=AccountKind.ASSET, account_type=AccountType.CHECKING, name=name, currency="CAD"
    )


def _budget(owner_id, group_id, name):
    return BaseBudget(owner_id=owner_id, group_id=group_id, name=name, currency="CAD", recurrence_freq=RecurrenceFreq.MONTHLY, recurrence_dom=1)


def _tax_advantaged_category(owner_id, group_id, name):
    return TaxAdvantagedCategory(
        category_owner_user_id=owner_id, group_id=group_id, name=name, tax_treatment=TaxTreatment.TAX_FREE, currency="CAD"
    )


def _tag(owner_id, group_id, name):
    return Tag(owner_id=owner_id, group_id=group_id, name=name)


def _merchant(owner_id, group_id, name):
    return Merchant(owner_id=owner_id, group_id=group_id, name=name)


def _category(owner_id, group_id, name):
    return Category(owner_id=owner_id, group_id=group_id, name=name, kind=CategoryKind.EXPENSE)


# Each kind the export scopes, with the rows that kind's group holds owned by nobody or by whoever made them
KINDS = {
    "accounts": (Account, scope.is_personal_account, _account, True),
    "budgets": (BaseBudget, scope.is_personal_budget, _budget, True),
    "tax-advantaged categories": (TaxAdvantagedCategory, scope.is_personal_tax_advantaged_category, _tax_advantaged_category, False),
    "tags": (Tag, scope.is_personal_tag, _tag, False),
    "merchants": (Merchant, scope.is_personal_merchant, _merchant, False),
    "categories": (Category, scope.is_personal_category, _category, True),
}


@pytest.mark.parametrize("kind", KINDS)
async def test_personal_scope_leaves_out_another_users_a_groups_and_shared_rows(kind):
    """A kind's scope keeps the user's own row and leaves out another user's, a group's and a shared one.

    The conditions guard the owner, the group and the shared flag, and the test checks their result together
    """
    model, is_personal, build, group_rows_have_no_owner = KINDS[kind]
    mine, theirs = await _seed_users("mine@example.com", "theirs@example.com")
    async with TestSession() as session:
        group = Group(owner_id=mine.id, name="Smith Family")
        session.add(group)
        await session.flush()
        rows = [
            build(mine.id, None, "mine"),
            build(theirs.id, None, "theirs"),
            build(None if group_rows_have_no_owner else mine.id, group.id, "group"),
        ]

        # The app ships categories and merchants every user shares, and no file lists them
        if kind == "categories":
            rows.append(Category(name="shared", kind=CategoryKind.EXPENSE, is_system=True))
        if kind == "merchants":
            rows.append(Merchant(name="shared", is_system=True))
        session.add_all(rows)
        await session.commit()

        names = (await session.scalars(select(model.name).where(is_personal(mine.id)))).all()

    assert names == ["mine"]
