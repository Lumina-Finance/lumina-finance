"""A sync saves what the user's import rules give each bank item it writes as waiting

The values are worked out once, when the item arrives, together with the digest of the rules that gave
them. A new item, a waiting item whose bank values changed and a dismissed item a date range brings
back are put through the rules, one the bank resends unchanged is left alone, and a rule load that
fails fills nothing and never fails the sync
"""

import uuid
from contextlib import contextmanager, nullcontext
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import event, select, update

from app.models.bank_connection import BankAccountLink
from app.models.bank_transaction import BankTransaction
from app.models.category import Category
from app.models.import_rule import ImportRule
from app.services.bank_sync import rule_fills
from app.services.bank_sync.ingestion import store_booked_records
from app.services.bank_sync.providers.contract import ProviderRecord
from app.services.bank_sync.range_days import RangeImport
from app.services.import_rules.loading import load_import_rules
from tests.conftest import TestSession, scoped_engine
from tests.routes.support.bank_sync_helpers import (
    _DISMISSED,
    BANK_DATE,
    BANK_DESCRIPTION,
    _commit_link,
    _commit_listed_connection,
    _commit_review_item,
    _owner_session,
    _stored_item,
)
from tests.routes.support.import_rule_helpers import (
    _create_rule_ok,
    _delete_rule_and_record_after_rules_load,
    _description_contains,
    _make_tag,
)
from tests.routes.support.query_helpers import _recorded_statements, _writes
from tests.routes.support.review_rule_helpers import _rules_inbox, _RulesInbox

_AT = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)
_STALE_VERSION = "b" * 64


def _record(external_id: str, description: str = BANK_DESCRIPTION, amount: int = -1250, **values) -> ProviderRecord:
    """Return a booked record the bank sends, the coffee on 3 October unless told otherwise"""
    fields = {"date": BANK_DATE, "raw_amount": f"{amount / 100:.2f}", "note": None, "merchant": None, "pending": False} | values
    return ProviderRecord(external_id=external_id, description=description, amount=amount, **fields)


async def _linked_inbox(client) -> _RulesInbox:
    """Sign up with the Harbour Coffee merchant and the Coffee category, and link Everyday to a bank account"""
    inbox = await _rules_inbox(client)
    await _commit_link(inbox.everyday_id, await _commit_listed_connection(inbox.user_id))
    return inbox


async def _coffee_rule(client, inbox: _RulesInbox, **overrides) -> dict:
    """Create the rule Coffee, which gives Harbour Coffee and the Coffee category to a description containing harbour"""
    values = {"merchant_id": inbox.merchant_id, "category_id": inbox.category_id} | overrides
    return await _create_rule_ok(client, inbox.headers, name="Coffee", conditions=[_description_contains("harbour")], **values)


async def _sync(inbox: _RulesInbox, records: list[ProviderRecord], *, running: RangeImport | None = None) -> bool:
    """Store the records a bank sends for Everyday as a sync does, in the owner's session, and commit"""
    async with _owner_session(inbox.user_id) as syncing:
        link = await syncing.scalar(select(BankAccountLink).where(BankAccountLink.account_id == uuid.UUID(inbox.everyday_id)))
        changed = await store_booked_records(syncing, [(link, records)], observed_at=_AT, running=running)
        await syncing.commit()
    return changed


async def _digest(inbox: _RulesInbox) -> str:
    """Return the digest of the user's rules as they stand"""
    async with TestSession() as session:
        return (await load_import_rules(session, inbox.user_id)).version


async def _stored(description: str) -> BankTransaction:
    """Return the one stored bank transaction with this description"""
    async with TestSession() as session:
        return await session.scalar(select(BankTransaction).where(BankTransaction.description == description))


@contextmanager
def _failing(statement_text: str):
    """Make every statement whose text holds this run as a division by zero, which fails inside the database"""

    def replace(conn, cursor, statement, parameters, context, executemany):
        """Swap the matching statement for one the database refuses"""
        return ("SELECT 1 / 0", ()) if statement_text in statement else (statement, parameters)

    event.listen(scoped_engine.sync_engine, "before_cursor_execute", replace, retval=True)
    try:
        yield
    finally:
        event.remove(scoped_engine.sync_engine, "before_cursor_execute", replace)


async def test_a_new_item_is_saved_with_the_rules_values_and_the_digest_and_one_that_matches_nothing_with_the_digest_alone(client):
    """The coffee is saved with its merchant, category and tag by id with the rule behind each, the library item with no fill, both at the digest"""
    inbox = await _linked_inbox(client)
    tag_id = await _make_tag(client, inbox.headers, "Treat")
    rule = await _coffee_rule(client, inbox, tag_ids=[tag_id])

    changed = await _sync(inbox, [_record("TRN-1"), _record("TRN-2", "LIBRARY FINES")])

    assert changed
    reference = {"id": rule["id"], "name": "Coffee"}
    coffee, library = await _stored(BANK_DESCRIPTION), await _stored("LIBRARY FINES")
    assert coffee.rule_fill == {
        "merchant": {"id": inbox.merchant_id, "rule": reference},
        "category": {"id": inbox.category_id, "rule": reference},
        "tags": [{"id": tag_id, "rule": reference}],
    }
    assert library.rule_fill is None
    assert (coffee.rules_version, library.rules_version) == (await _digest(inbox),) * 2


async def test_an_item_for_a_person_with_no_rules_gets_the_digest_of_no_rules_and_no_fill(client):
    """The digest of an empty set is saved, so a rule created later is told apart from items never put through one"""
    inbox = await _linked_inbox(client)

    await _sync(inbox, [_record("TRN-1")])

    stored = await _stored(BANK_DESCRIPTION)
    assert stored.rule_fill is None
    assert stored.rules_version == await _digest(inbox)


async def test_a_category_of_the_other_direction_and_tags_past_the_limit_are_saved_as_left_out_with_why(client):
    """A refund of +50.00 matches a rule giving an expense category, so the category is saved as left out for the direction it fits"""
    inbox = await _linked_inbox(client)
    rule = await _coffee_rule(client, inbox)

    await _sync(inbox, [_record("TRN-1", "HARBOUR REFUND", amount=5000)])

    stored = await _stored("HARBOUR REFUND")
    assert stored.rule_fill == {
        "merchant": {"id": inbox.merchant_id, "rule": {"id": rule["id"], "name": "Coffee"}},
        "category_left_out": {"id": inbox.category_id, "rule": {"id": rule["id"], "name": "Coffee"}, "reason": "expense_for_money_in"},
    }


async def test_a_sync_of_many_new_items_loads_the_rules_once_and_never_updates_an_item_it_inserted(client):
    """Three new items read the rules in one statement and are written as inserts alone, and a sync writing no waiting item reads none"""
    inbox = await _linked_inbox(client)
    await _coffee_rule(client, inbox)

    with _recorded_statements() as statements:
        await _sync(inbox, [_record(f"TRN-{number}") for number in range(3)])
    with _recorded_statements() as unchanged:
        await _sync(inbox, [_record(f"TRN-{number}") for number in range(3)])

    assert sum("FROM import_rules" in statement for statement in statements) == 1
    assert any(write.startswith("INSERT INTO bank_transactions") for write in _writes(statements))
    assert not any(write.startswith("UPDATE bank_transactions") for write in _writes(statements))
    assert not any("FROM import_rules" in statement for statement in unchanged), "a call that writes no waiting item loads nothing"
    assert _writes(unchanged) == [], "and writes nothing"


async def test_a_changed_waiting_item_and_a_restored_dismissed_item_are_put_through_the_rules_again_and_an_unchanged_resend_is_left_alone(
    client,
):
    """The renamed item and the dismissed one a range brings back are filled, and the resent item keeps its values, digest and version"""
    inbox = await _linked_inbox(client)
    await _coffee_rule(client, inbox)
    stale = {"merchant": {"id": str(uuid.uuid4()), "rule": {"id": str(uuid.uuid4()), "name": "Old"}}}
    renamed = await _commit_review_item(inbox.everyday_id, "TRN-1", description="LIBRARY FINES", rules_version=_STALE_VERSION)
    resent = await _commit_review_item(inbox.everyday_id, "TRN-2", rule_fill=stale, rules_version=_STALE_VERSION)
    dismissed = await _commit_review_item(inbox.everyday_id, "TRN-3", **_DISMISSED)
    resent_before = await _stored_item(resent)
    digest = await _digest(inbox)
    records = [_record("TRN-1"), _record("TRN-2"), _record("TRN-3", "HARBOUR RESTORED")]
    restoring = RangeImport(date(2026, 10, 1), date(2026, 10, 31), date(2026, 10, 1), restores_dismissed=True)

    await _sync(inbox, records, running=restoring)

    for item_id in (renamed, dismissed):
        stored = await _stored_item(item_id)
        assert stored.rule_fill["merchant"]["id"] == inbox.merchant_id
        assert stored.rules_version == digest
    assert (await _stored_item(renamed)).version == 2, "the fill and the new bank values are one update"
    resent_after = await _stored_item(resent)
    assert (resent_after.rule_fill, resent_after.rules_version, resent_after.version) == (stale, _STALE_VERSION, resent_before.version)


@pytest.mark.parametrize("failure", ["python", "statement"])
async def test_a_rule_load_that_fails_fills_nothing_and_the_sync_still_stores_the_item(client, failure):
    """A rule with a broken condition fails in Python and one read made to fail fails in the database, and either way the item is saved unfilled"""
    inbox = await _linked_inbox(client)
    rule = await _coffee_rule(client, inbox)
    if failure == "python":
        async with TestSession() as session:
            await session.execute(update(ImportRule).where(ImportRule.id == uuid.UUID(rule["id"])).values(conditions=[{"kind": "condition"}]))
            await session.commit()

    with _failing("FROM import_rules") if failure == "statement" else nullcontext():
        changed = await _sync(inbox, [_record("TRN-1")])

    assert changed
    stored = await _stored(BANK_DESCRIPTION)
    assert (stored.rule_fill, stored.rules_version) == (None, None)
    assert stored.observed_amount == -1250


async def test_a_category_deleted_after_the_sync_read_the_rules_leaves_the_item_unfilled_and_the_sync_still_stores_it(client, monkeypatch):
    """The rule naming the category goes with it once the sync has read the rules, so the item is saved with no fill and no digest"""
    inbox = await _linked_inbox(client)
    rule = await _coffee_rule(client, inbox)
    _delete_rule_and_record_after_rules_load(monkeypatch, rule_fills, rule["id"], Category, inbox.category_id)

    changed = await _sync(inbox, [_record("TRN-1")])

    assert changed
    stored = await _stored(BANK_DESCRIPTION)
    assert (stored.rule_fill, stored.rules_version) == (None, None)
    assert stored.observed_amount == -1250
