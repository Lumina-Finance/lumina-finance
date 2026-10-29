/**
 * Tests the sentence a list row gives for a refund link, so the refund and the expense it refunds can
 * be told apart and a row with no link says nothing
 */
import { describe, expect, it } from 'vitest'
import { getRefundLinkLabel } from '@/components/transactions/utils/refundLink'

describe('getRefundLinkLabel', () => {
  it('says nothing for an unlinked transaction', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: null, refund_transaction_ids: [] })).toBeNull()
  })

  it('names the refund as the refund', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: 'expense', refund_transaction_ids: [] })).toBe(
      'Refund of an expense',
    )
  })

  it('names the expense as refunded, counting its refunds', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: null, refund_transaction_ids: ['a'] })).toBe('Refunded once')
    expect(getRefundLinkLabel({ refund_of_transaction_id: null, refund_transaction_ids: ['a', 'b'] })).toBe(
      'Refunded 2 times',
    )
  })

  it('names both sides of a refund that was itself refunded', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: 'expense', refund_transaction_ids: ['a'] })).toBe(
      'Refund of an expense, Refunded once',
    )
  })
})
