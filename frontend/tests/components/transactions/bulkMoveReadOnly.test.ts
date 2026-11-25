/**
 * Guards a bulk edit against accounts the server keeps read-only. A move writes each row to its new
 * account, so the Move to account dropdown offers no read-only account, and a selection on one, or a move
 * onto one, is held back before the request rather than refused by it
 */
import { describe, expect, it } from 'vitest'
import { getBulkEditBlockers, getBulkMoveTargets } from '@/components/transactions/bulk-edit/selection'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'
import { groceries, untouched, writableAccounts } from '@tests/components/transactions/bulkEditFixtures'

const READ_ONLY = 'Records in USD are read-only. They can be archived or deleted'
const US_CARD: TransactionListAccount = {
  id: 'us_card',
  name: 'US card',
  currency: 'CAD',
  can_write: true,
  group_id: null,
  read_only_reason: READ_ONLY,
}
const ACCOUNTS = [...writableAccounts, US_CARD]

describe('a bulk move and read-only accounts', () => {
  it('offers no read-only account to move onto', () => {
    expect(getBulkMoveTargets(ACCOUNTS, ['CAD']).map((account) => account.id)).toEqual(['chequing', 'savings', 'cash'])
  })

  it('holds back a move onto a read-only account', () => {
    const blockers = getBulkEditBlockers([groceries], untouched({ accountId: 'us_card' }), undefined, ACCOUNTS)

    expect(blockers.unavailableOwnAccount).toEqual([groceries.id])
  })

  it('holds back a row on a read-only account, whatever the edit', () => {
    const onCard = { ...groceries, accountId: 'us_card' }

    expect(getBulkEditBlockers([onCard], untouched(), undefined, ACCOUNTS).unavailableOwnAccount).toEqual([onCard.id])
  })

  it('lets a move between accounts that take writes through', () => {
    const blockers = getBulkEditBlockers([groceries], untouched({ accountId: 'savings' }), undefined, ACCOUNTS)

    expect(blockers.unavailableOwnAccount).toEqual([])
  })
})
