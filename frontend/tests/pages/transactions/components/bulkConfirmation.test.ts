/**
 * Tests which stored transaction changes invalidate a pending bulk-edit confirmation
 */
import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/api/transactions'
import { selectedTransactionsSignature } from '@/pages/transactions/components/bulk-edit/confirmation'

const selected: Transaction = {
  id: 'txn-1',
  created_by_user_id: 'user-1',
  account_id: 'chequing',
  dt: '2026-08-01',
  merchant_id: 'merchant-1',
  merchant_name: 'Corner Market',
  category_id: 'groceries',
  amount: -4400,
  account_amount: -4400,
  base_currency_amount: -4400,
  currency: 'CAD',
  fx_rate: null,
  notes: 'Weekly shop',
  counterparty_account_id: null,
  counterparty_account_scope: null,
  created_at: '2026-08-01T12:00:00Z',
  updated_at: '2026-08-01T12:00:00Z',
  tag_ids: ['tag-b', 'tag-a'],
  tags: [
    { id: 'tag-b', group_id: null, name: 'Household' },
    { id: 'tag-a', group_id: null, name: 'Essential' },
  ],
}

const unselected: Transaction = {
  ...selected,
  id: 'txn-2',
  amount: -1200,
  notes: 'Coffee',
  tag_ids: [],
  tags: [],
}

/** Returns the signature for one selected transaction unless a test specifies the full list */
function signature(
  transaction: Transaction,
  selectedIds: string[] = ['txn-1'],
  transactions: Transaction[] = [transaction],
) {
  return selectedTransactionsSignature(transactions, selectedIds)
}

const storedValueChanges = [
  ['direction', { amount: 4400 }],
  ['magnitude', { amount: -4500 }],
  ['update timestamp', { updated_at: '2026-08-01T12:01:00Z' }],
  ['account', { account_id: 'savings' }],
  ['date', { dt: '2026-08-02' }],
  ['merchant', { merchant_id: 'merchant-2' }],
  ['category', { category_id: 'dining' }],
  ['currency', { currency: 'USD' }],
  ['exchange rate', { fx_rate: 1.37 }],
  ['note', { notes: 'Changed note' }],
  ['counterparty account', { counterparty_account_id: 'savings' }],
  ['counterparty scope', { counterparty_account_scope: 'outside' }],
] satisfies [string, Partial<Transaction>][]

describe('the values bound to bulk-edit confirmation', () => {
  it.each(storedValueChanges)(
    'changes when the selected transaction changes its %s',
    (_field, patch) => {
      expect(signature({ ...selected, ...patch })).not.toBe(signature(selected))
    },
  )

  it('changes when tag membership changes without an update timestamp change', () => {
    expect(signature({ ...selected, tag_ids: ['tag-a', 'tag-c'] })).not.toBe(signature(selected))
  })

  it('matches fresh objects with the same stored values', () => {
    expect(signature({ ...selected, tag_ids: [...selected.tag_ids] })).toBe(signature(selected))
  })

  it('matches when selected rows and their tags arrive in another order', () => {
    const first = selectedTransactionsSignature([selected, unselected], ['txn-1', 'txn-2'])
    const second = selectedTransactionsSignature(
      [
        { ...unselected },
        { ...selected, tag_ids: ['tag-a', 'tag-b'] },
      ],
      ['txn-2', 'txn-1'],
    )

    expect(second).toBe(first)
  })

  it('matches when only calculated amounts and display labels change', () => {
    expect(
      signature({
        ...selected,
        account_amount: -4500,
        base_currency_amount: -4300,
        merchant_name: 'Renamed merchant',
        tags: selected.tags.map((tag) => ({ ...tag, name: `Renamed ${tag.name}` })),
      }),
    ).toBe(signature(selected))
  })

  it('changes when a selected transaction is removed', () => {
    expect(selectedTransactionsSignature([unselected], ['txn-2'])).not.toBe(
      selectedTransactionsSignature([selected, unselected], ['txn-1', 'txn-2']),
    )
  })

  it('changes when a selected transaction is replaced', () => {
    const replacement = { ...selected, id: 'txn-replacement' }

    expect(selectedTransactionsSignature([replacement], [replacement.id])).not.toBe(signature(selected))
  })

  it('ignores changes to an unselected transaction', () => {
    const first = selectedTransactionsSignature([selected, unselected], ['txn-1'])
    const second = selectedTransactionsSignature(
      [selected, { ...unselected, amount: -9900, notes: 'Changed outside the selection' }],
      ['txn-1'],
    )

    expect(second).toBe(first)
  })
})
