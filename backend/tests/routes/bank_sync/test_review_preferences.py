"""Reading and saving whether each kind of bank data arriving for an account waits for review or is applied as it arrives

An account that read the wrong choice would apply bank changes the user asked to review, or hold
back ones they chose to trust. A save that left a mix of two saves made at once, touched the items
already waiting, lost the choice when the account was unlinked and linked again, or marked the
user's data changed and so ended the undo of their last import, would each go unnoticed until the
bank next sent something. Only the owner's own personal account has preferences
"""

import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select

from app.models.account_review_preference import AccountReviewPreference
from app.models.cache_state import UserCacheState
from tests.conftest import TestSession
from tests.routes.support.bank_sync_helpers import (
    _changed_at,
    _commit_accepted_items,
    _commit_link,
    _commit_listed_connection,
    _commit_other_users_account,
    _commit_waiting_items,
    _import_a_file,
    _ledger_rows,
    _link,
    _new_account,
    _new_group_account,
    _read_review_preferences,
    _review_page,
    _save_review_preferences,
    _sign_up,
    _undoable_import,
)
from tests.routes.support.lock_helpers import _cancel_unfinished, _wait_until_waiting_on

_REVIEW_ALL = {"new_transactions": "review", "corrections": "review", "removals": "review"}
_AUTO_APPROVE_ALL = {"new_transactions": "trust", "corrections": "trust", "removals": "trust"}

# Each kind auto-approved alone. Saved after its opposite, the three between them set every choice
# to each decision, from the other
_ONE_KIND_TRUSTED = [{**_REVIEW_ALL, kind: "trust"} for kind in _REVIEW_ALL]


async def test_review_preferences_of_a_newly_linked_account_read_review_all(client):
    """Everyday has just been linked, and nothing was ever saved for it"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    connection = await _commit_listed_connection(user_id, discovered_at=datetime.now(UTC))
    linked = await _link(client, headers, account_id, connection.id)

    assert linked.status_code == 201, linked.text
    assert await _read_review_preferences(client, headers, account_id) == _REVIEW_ALL


@pytest.mark.parametrize("choices", _ONE_KIND_TRUSTED, ids=lambda choices: "-".join(choices.values()))
async def test_saving_review_preferences_replaces_every_choice_the_account_held(client, choices):
    """Everyday holds the opposite of each choice, and the save replaces all three. They read back as saved"""
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    opposite = {kind: "review" if decision == "trust" else "trust" for kind, decision in choices.items()}
    assert (await _save_review_preferences(client, headers, account_id, opposite)).status_code == 200

    saved = await _save_review_preferences(client, headers, account_id, choices)

    assert saved.status_code == 200, saved.text
    assert saved.json() == choices
    assert await _read_review_preferences(client, headers, account_id) == choices


async def test_saving_review_preferences_tells_open_pages_and_leaves_the_last_import_undoable(client):
    """The user imported a file, then saved Auto-approve all for Everyday

    Their open pages are told, as of a status change, since a choice changes none of their data.
    Marked as a data change, it would stop the user undoing the import
    """
    headers, _ = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    await _import_a_file(client, headers)
    before = await _changed_at(client, headers)

    saved = await _save_review_preferences(client, headers, account_id, _AUTO_APPROVE_ALL)

    assert saved.status_code == 200, saved.text
    assert await _changed_at(client, headers) != before
    assert await _undoable_import(client, headers) is not None


async def test_auto_approving_all_leaves_every_item_already_waiting_as_it_was(client):
    """12 new items and a correction wait on Everyday when the user switches it to Auto-approve all

    Each keeps waiting exactly as it was and the ledger is unchanged, since a choice applies only to
    bank data arriving afterwards
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    link = await _commit_link(account_id, await _commit_listed_connection(user_id))
    await _commit_waiting_items(link, 12)
    await _commit_accepted_items(link, corrections=1)
    waiting = await _review_page(client, headers, account_id=account_id)
    ledger = await _ledger_rows(account_id)

    saved = await _save_review_preferences(client, headers, account_id, _AUTO_APPROVE_ALL)

    assert saved.status_code == 200, saved.text
    assert waiting["counts"] == {"new": 12, "correction": 1, "removal": 0}
    assert await _review_page(client, headers, account_id=account_id) == waiting
    assert await _ledger_rows(account_id) == ledger


async def test_review_preferences_stay_with_the_account_when_it_is_unlinked_and_linked_through_another_connection(client):
    """Everyday auto-approves all while linked to ACT-1, then is unlinked and linked to ACT-2 on a second connection"""
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    first = await _commit_listed_connection(user_id, "ACT-1", discovered_at=datetime.now(UTC))
    second = await _commit_listed_connection(user_id, "ACT-2", discovered_at=datetime.now(UTC))
    assert (await _link(client, headers, account_id, first.id, "ACT-1")).status_code == 201
    assert (await _save_review_preferences(client, headers, account_id, _AUTO_APPROVE_ALL)).status_code == 200

    unlinked = await client.delete(f"/accounts/{account_id}/bank-link", headers=headers)
    relinked = await _link(client, headers, account_id, second.id, "ACT-2")

    assert unlinked.status_code == 200, unlinked.text
    assert relinked.status_code == 201, relinked.text
    assert await _read_review_preferences(client, headers, account_id) == _AUTO_APPROVE_ALL


async def test_two_saves_at_once_leave_the_later_saves_choices_whole(client):
    """Two tabs save Everyday's first choices at once: Auto-approve all, then only corrections auto-approved

    The later save waits on the row the first writes, then replaces all three, so the account ends
    on the later choices rather than a mix of the two, and neither save fails on the row the other
    created
    """
    headers, user_id = await _sign_up(client)
    account_id = await _new_account(client, headers, "Everyday")
    corrections_only = {"new_transactions": "review", "corrections": "trust", "removals": "review"}

    requests: list[asyncio.Task] = []
    try:
        async with asyncio.timeout(10), TestSession() as holder:
            # The user's cache row is the last row a save writes, so holding it keeps the first save
            # waiting with its choices written but not committed
            await holder.execute(select(UserCacheState.user_id).where(UserCacheState.user_id == user_id).with_for_update())
            holder_pid = await holder.scalar(select(func.pg_backend_pid()))
            requests.append(asyncio.create_task(_save_review_preferences(client, headers, account_id, _AUTO_APPROVE_ALL)))
            await _wait_until_waiting_on(holder_pid, requests[0])
            requests.append(asyncio.create_task(_save_review_preferences(client, headers, account_id, corrections_only)))
            await _wait_until_waiting_on(holder_pid, requests[1], waiters=2)
            await holder.commit()
            first, later = await asyncio.gather(*requests)
    finally:
        await _cancel_unfinished(requests)

    assert first.status_code == 200, first.text
    assert later.status_code == 200, later.text
    assert (first.json(), later.json()) == (_AUTO_APPROVE_ALL, corrections_only)
    assert await _read_review_preferences(client, headers, account_id) == corrections_only


@pytest.mark.parametrize("method", ["GET", "PUT"])
async def test_review_preferences_of_a_group_account_or_another_users_account_are_refused(client, method):
    """Joint belongs to the Smith Family group, administered by the user, and Theirs to another user

    Joint isn't the user's alone, so it has no preferences for them, and Theirs isn't found. Nothing
    is saved for either
    """
    headers, _ = await _sign_up(client)
    joint_id = await _new_group_account(client, headers)
    theirs = await _commit_other_users_account()
    refusals = [
        (joint_id, 403, "Review preferences are only available on your own accounts"),
        (str(theirs.id), 404, "Account not found"),
    ]

    for account_id, status_code, detail in refusals:
        body = _AUTO_APPROVE_ALL if method == "PUT" else None
        response = await client.request(method, f"/accounts/{account_id}/review-preferences", json=body, headers=headers)

        assert response.status_code == status_code, response.text
        assert response.json()["detail"] == detail
    async with TestSession() as session:
        assert await session.scalar(select(func.count()).select_from(AccountReviewPreference)) == 0
