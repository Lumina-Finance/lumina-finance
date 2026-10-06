/**
 * Tests the one place bulk delete leaves group accounts out in the browser
 */
import { describe, expect, it } from 'vitest'
import { GROUP_ACCOUNT_BULK_DELETE_REASON, getBulkDeleteBlockReason } from '@/pages/transactions/components/bulk-edit/deletion'
import type { TransactionListAccount } from '@/pages/transactions/types/transactionList'

const personal: TransactionListAccount = { id: 'personal', can_write: true, group_id: null }
const shared: TransactionListAccount = { id: 'shared', can_write: true, group_id: 'household' }
const accountMap = new Map([[personal.id, personal], [shared.id, shared]])

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
