"""Pluggy pending transaction tests

Guards how pending transactions reach the sync: Pluggy marks them with a status and gives them the id
they keep when they post, so they are kept only when the sync asks for them, and they follow the
same window and date rules as posted ones
"""

from datetime import date

from tests.services.bank_sync.providers.pluggy.stand_ins import (
    PluggyApi,
    account,
    fetch,
    item,
    pluggy_adapter,
    transaction,
    transactions_body,
)


def _api() -> PluggyApi:
    """Return Pluggy holding a card with one posted transaction, a pending one, and a pending one outside the window"""
    return (
        PluggyApi()
        .serve_sign_in()
        .serve_item(item(), account("acc-card", kind="CREDIT", balance="100.00"))
        .serve_transactions(
            "acc-card",
            transactions_body(
                transaction("tx-posted", "20.00", date="2026-10-01T11:00:00.000Z"),
                transaction("tx-pending", "12.00", date="2026-10-03T11:00:00.000Z", status="PENDING", description="LOJA ONLINE"),
                transaction("tx-later", "5.00", date="2026-10-04T11:00:00.000Z", status="PENDING"),
            ),
        )
    )


async def test_fetch_marks_a_pending_transaction_with_the_id_it_will_keep_and_signs_it_like_a_posted_one():
    """The pending row comes with Pluggy's own id and, on a card, as a charge"""
    result = await fetch(pluggy_adapter(_api().transport), "acc-card", include_pending=True)

    [card] = result.accounts
    assert [(record.external_id, record.pending, record.amount, record.date) for record in card.records] == [
        ("tx-posted", False, -2000, date(2026, 10, 1)),
        ("tx-pending", True, -1200, date(2026, 10, 3)),
    ]


async def test_fetch_leaves_pending_transactions_out_unless_the_sync_asks_for_them():
    """A pending row is dropped rather than stored as posted when the sync doesn't want pending ones"""
    result = await fetch(pluggy_adapter(_api().transport), "acc-card")

    assert [(record.external_id, record.pending) for record in result.accounts[0].records] == [("tx-posted", False)]
