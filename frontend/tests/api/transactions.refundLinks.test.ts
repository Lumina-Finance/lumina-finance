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

import { unlinkRefund } from '@/api/transactions'

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue(undefined)
})

describe('unlinkRefund', () => {
  it('deletes the refund link of the refund it is given', async () => {
    await unlinkRefund('refund-1')

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/transactions/refund-1/refund-link', { method: 'DELETE' })
  })
})
