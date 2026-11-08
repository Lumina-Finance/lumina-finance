/**
 * Covers the ids a transaction modal gives its elements, so a refund dialogue stacked over the
 * dialogue of the expense it refunds never shares an id with it
 */
import { describe, expect, it } from 'vitest'
import { getTransactionModalIds } from '@/components/transactions/transaction-modal/ids'

describe('getTransactionModalIds', () => {
  it('keeps the failed save message of a stacked refund dialogue apart from the one under it', () => {
    expect(getTransactionModalIds('').submitError).toBe('txn-submit-error')
    expect(getTransactionModalIds('-refund').submitError).toBe('txn-submit-error-refund')
  })
})
