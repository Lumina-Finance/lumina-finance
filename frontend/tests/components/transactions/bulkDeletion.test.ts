/**
 * Tests the one place bulk delete leaves group accounts out in the browser
 */
import { describe, expect, it } from 'vitest'
import {
  GROUP_ACCOUNT_BULK_DELETE_REASON,
  getBulkDeleteBlockReason,
  getLinkedIdsOutside,
} from '@/components/transactions/bulk-edit/deletion'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'

const personal: TransactionListAccount = { id: 'personal', can_write: true, group_id: null }
const shared: TransactionListAccount = { id: 'shared', can_write: true, group_id: 'household' }
const accountMap = new Map([
  [personal.id, personal],
  [shared.id, shared],
])

describe('whether the ticked transactions can be deleted together', () => {
  it('allows a selection in personal accounts only', () => {
    expect(getBulkDeleteBlockReason(['personal', 'personal'], accountMap)).toBeUndefined()
  })

  it('refuses a selection holding a row in a group account', () => {
    expect(getBulkDeleteBlockReason(['personal', 'shared'], accountMap)).toBe(GROUP_ACCOUNT_BULK_DELETE_REASON)
  })

  it('refuses every row on the page of a group account', () => {
    expect(getBulkDeleteBlockReason(['shared'], new Map(), shared)).toBe(GROUP_ACCOUNT_BULK_DELETE_REASON)
  })
})

describe('which linked transactions a bulk delete leaves on the other side', () => {
  const unlinked = { id: 'plain', refund_of_transaction_id: null, refund_transaction_ids: [] }
  const refund = { id: 'refund', refund_of_transaction_id: 'expense', refund_transaction_ids: [] }
  const expense = { id: 'expense', refund_of_transaction_id: null, refund_transaction_ids: ['refund', 'other'] }

  it('has none when nothing selected is linked', () => {
    expect(getLinkedIdsOutside([unlinked])).toEqual([])
  })

  it('names the expense of a selected refund and the refunds of a selected expense', () => {
    expect(getLinkedIdsOutside([refund])).toEqual(['expense'])
    expect(getLinkedIdsOutside([expense])).toEqual(['refund', 'other'])
  })

  it('leaves out a linked transaction that is selected too, and names a shared one once', () => {
    expect(getLinkedIdsOutside([expense, refund])).toEqual(['other'])
    expect(getLinkedIdsOutside([refund, { ...refund, id: 'second' }])).toEqual(['expense'])
  })
})
