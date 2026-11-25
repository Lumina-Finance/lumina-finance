/**
 * Guards Add to ledger on a bank item in an account the server keeps read-only. The account's reason holds
 * the submit back, before any reason an earlier press left, and the submit runs nothing. Items on accounts
 * that take writes keep the refusal's own reason, if any
 */
import { describe, expect, it } from 'vitest'
import { getReviewSubmitHold } from '@/components/transactions/transaction-modal/utils/reviewSubmit'

const READ_ONLY = 'Records in USD are read-only. They can be archived or deleted'

describe('what holds back Add to ledger', () => {
  it("gives a read-only account's reason, before a refusal's, and runs nothing", () => {
    expect(getReviewSubmitHold({ read_only_reason: READ_ONLY }, 'Choose a category', false)).toEqual({
      submitBlockedReason: READ_ONLY,
      submitReadOnly: true,
    })
  })

  it("keeps a refusal's reason, or none, on an account that takes writes", () => {
    expect(getReviewSubmitHold({ read_only_reason: null }, 'Choose a category', false)).toEqual({
      submitBlockedReason: 'Choose a category',
      submitReadOnly: false,
    })
    expect(getReviewSubmitHold(undefined, undefined, false)).toEqual({
      submitBlockedReason: undefined,
      submitReadOnly: false,
    })
  })

  it('keeps a form read-only for another reason read-only', () => {
    expect(getReviewSubmitHold(undefined, undefined, true).submitReadOnly).toBe(true)
  })
})
