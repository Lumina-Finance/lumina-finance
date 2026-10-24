/**
 * Tests which account field the transaction modal puts on top, so the source account leads on a
 * transfer pair whichever way the money moves, and each field moves whole
 */
import { describe, expect, it } from 'vitest'
import { getTransactionFieldLayout, orderAccountFields } from '@/components/transactions/transaction-modal/utils/accountFields'

describe('account field ordering', () => {
  const recorded = { name: 'recorded' }
  const counterparty = { name: 'counterparty' }

  it('keeps the recorded account on top for an ordinary transfer, whichever way the money goes', () => {
    for (const direction of ['debit', 'credit'] as const) {
      expect(orderAccountFields(recorded, counterparty, { isSymmetricTransfer: false, direction }))
        .toEqual([recorded, counterparty])
    }
  })

  it('keeps the recorded account on top for a pair going out of it', () => {
    expect(orderAccountFields(recorded, counterparty, { isSymmetricTransfer: true, direction: 'debit' }))
      .toEqual([recorded, counterparty])
  })

  it('puts the counterparty account on top for a pair coming into the recorded one, since it is the source', () => {
    expect(orderAccountFields(recorded, counterparty, { isSymmetricTransfer: true, direction: 'credit' }))
      .toEqual([counterparty, recorded])
  })

  it('moves each field whole, so its value, error and options cannot land on opposite sides', () => {
    const [top, second] = orderAccountFields(recorded, counterparty, {
      isSymmetricTransfer: true,
      direction: 'credit',
    })

    expect(top).toBe(counterparty)
    expect(second).toBe(recorded)
  })
})

describe('transaction field layout', () => {
  it('sends a refusal to the control each account field is drawn in, which swaps with the pair direction', () => {
    const ordinary = getTransactionFieldLayout({ isSymmetricTransfer: false, direction: 'credit' })
    expect(ordinary.order.slice(0, 2)).toEqual(['account_id', 'counterparty_account_id'])
    expect(ordinary.controlIds.account_id).toBe('txn-account')
    expect(ordinary.controlIds.counterparty_account_id).toBe('txn-counterparty-account')

    const pairInto = getTransactionFieldLayout({ isSymmetricTransfer: true, direction: 'credit' })
    expect(pairInto.order.slice(0, 2)).toEqual(['counterparty_account_id', 'account_id'])
    expect(pairInto.controlIds.counterparty_account_id).toBe('txn-account')
    expect(pairInto.controlIds.account_id).toBe('txn-counterparty-account')
  })
})
