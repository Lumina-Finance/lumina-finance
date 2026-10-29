/**
 * Tests the words a list row uses for a refund link, so the refund and the expense it refunds can be
 * told apart at a glance and a row with no link says nothing
 */
import { describe, expect, it } from 'vitest'
import { getRefundLinkLabel } from '@/components/transactions/utils/refundLink'

describe('getRefundLinkLabel', () => {
  it('says nothing for an unlinked transaction', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: null, refund_transaction_ids: [] })).toBeNull()
  })

  it('names the refund as the refund', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: 'expense', refund_transaction_ids: [] })).toEqual({
      short: 'Refund',
      full: 'Refund of an expense',
    })
  })

  it('names the expense as refunded, counting its refunds', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: null, refund_transaction_ids: ['a'] })).toEqual({
      short: 'Refunded',
      full: 'Refunded once',
    })
    expect(getRefundLinkLabel({ refund_of_transaction_id: null, refund_transaction_ids: ['a', 'b'] })?.full).toBe(
      'Refunded 2 times',
    )
  })

  it('reads a refund that was itself refunded as the refund, naming both sides in full', () => {
    expect(getRefundLinkLabel({ refund_of_transaction_id: 'expense', refund_transaction_ids: ['a'] })).toEqual({
      short: 'Refund',
      full: 'Refund of an expense, Refunded once',
    })
  })
})
