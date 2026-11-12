/**
 * Tests the one place bulk delete decides, in the browser, what stops ticked transactions going together:
 * any in a group account, and any a bank imported into an account still linked
 */
import { describe, expect, it } from 'vitest'
import {
  GROUP_ACCOUNT_BULK_DELETE_REASON,
  getBulkDeleteBlockReason,
  getLinkedIdsOutside,
} from '@/components/transactions/bulk-edit/deletion'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'

const personal: TransactionListAccount = { id: 'personal', name: 'Everyday', can_write: true, group_id: null }
const savings: TransactionListAccount = { id: 'savings', name: 'Savings', can_write: true, group_id: null }
const shared: TransactionListAccount = { id: 'shared', name: 'Shared', can_write: true, group_id: 'household' }
const accountMap = new Map([
  [personal.id, personal],
  [savings.id, savings],
  [shared.id, shared],
])

// Everyday is linked, Savings isn't
const linksByAccount = new Map([[personal.id, {}]])
const FROM_THE_BANK = { provider_name: 'SimpleFIN' }

/** A ticked transaction in the account, imported from the bank when given its source */
function ticked(accountId: string, bankSource: typeof FROM_THE_BANK | null = null) {
  return { account_id: accountId, bank_source: bankSource }
}

describe('whether the ticked transactions can be deleted together', () => {
  it('allows a selection in personal accounts only', () => {
    expect(getBulkDeleteBlockReason([ticked('personal'), ticked('personal')], accountMap)).toBeUndefined()
  })

  it('refuses a selection holding a row in a group account', () => {
    expect(getBulkDeleteBlockReason([ticked('personal'), ticked('shared')], accountMap)).toBe(
      GROUP_ACCOUNT_BULK_DELETE_REASON,
    )
  })

  it('refuses every row on the page of a group account', () => {
    expect(getBulkDeleteBlockReason([ticked('shared')], new Map(), shared)).toBe(GROUP_ACCOUNT_BULK_DELETE_REASON)
  })

  it('refuses a selection holding a bank-imported row while its account is linked, naming the provider and the account as the server does', () => {
    const reason = getBulkDeleteBlockReason(
      [ticked('savings'), ticked('personal', FROM_THE_BANK)],
      accountMap,
      undefined,
      linksByAccount,
    )

    expect(reason).toBe("While Everyday is linked, you can't delete transactions from SimpleFIN")
  })

  it.each([
    ['its account is no longer linked', ticked('savings', FROM_THE_BANK)],
    ['it was entered by hand in a linked account', ticked('personal')],
  ])('allows a bank-imported row when %s', (_, row) => {
    expect(getBulkDeleteBlockReason([row], accountMap, undefined, linksByAccount)).toBeUndefined()
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
