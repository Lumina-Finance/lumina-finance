/**
 * Covers the request that unlinks a refund, which names the refund and nothing else, so a link is
 * removed from either transaction's modal with the same call
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import { bulkDeleteTransactions, fetchRefundLinkCandidates, linkRefund, unlinkRefund } from '@/api/transactions'

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue(undefined)
})

describe('linkRefund', () => {
  it('posts the expense the existing refund is a refund of', async () => {
    await linkRefund('refund-1', 'expense-1')

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions/refund-1/refund-link', {
      method: 'POST',
      body: JSON.stringify({ original_transaction_id: 'expense-1' }),
    })
  })
})

describe('fetchRefundLinkCandidates', () => {
  it('asks for the candidates of one transaction, with the search only when there is one', async () => {
    await fetchRefundLinkCandidates('expense-1', '')
    await fetchRefundLinkCandidates('expense-1', 'store credit')

    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, '/transactions/expense-1/refund-link-candidates', {
      signal: undefined,
    })
    expect(authenticatedFetchMock.mock.calls[1][0]).toBe(
      '/transactions/expense-1/refund-link-candidates?q=store+credit',
    )
  })

  it('sends the list filters it is given, each selected value as its own key', async () => {
    await fetchRefundLinkCandidates('expense-1', '', { account_id: ['a', 'b'], from_date: '2026-03-01' })

    expect(authenticatedFetchMock.mock.calls[0][0]).toBe(
      '/transactions/expense-1/refund-link-candidates?account_id=a&account_id=b&from_date=2026-03-01',
    )
  })
})

describe('bulkDeleteTransactions', () => {
  it('sends exactly the ids it is given', async () => {
    await bulkDeleteTransactions(['a', 'b'])

    expect(JSON.parse(authenticatedFetchMock.mock.calls[0][1].body)).toEqual({ transaction_ids: ['a', 'b'] })
  })
})

describe('unlinkRefund', () => {
  it('deletes the refund link of the refund it is given', async () => {
    await unlinkRefund('refund-1')

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions/refund-1/refund-link', { method: 'DELETE' })
  })
})
