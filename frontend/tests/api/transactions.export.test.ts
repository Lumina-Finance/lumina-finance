/**
 * Covers the request the transaction export sends, since a filter left out of it saves a file holding
 * more than the list on screen shows
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedRequestMock } = vi.hoisted(() => ({
  authenticatedRequestMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: vi.fn(),
  authenticatedRequest: authenticatedRequestMock,
}))

import { fetchTransactionsCsv } from '@/api/transactions'

beforeEach(() => {
  authenticatedRequestMock.mockReset()
  authenticatedRequestMock.mockResolvedValue(new Response('Date,Merchant\r\n'))
})

describe('fetchTransactionsCsv', () => {
  it('sends every filter and the submitted search, each multi-value filter as repeated keys', async () => {
    await fetchTransactionsCsv({
      account_id: ['acc_1', 'acc_2'],
      category_id: ['cat_1'],
      tag_id: ['tag_1', 'tag_2'],
      tag_match: 'any',
      currency: 'CAD',
      min_amount: 500,
      max_amount: 9000,
      amount_currency: 'CAD',
      from_date: '2026-01-01',
      to_date: '2026-01-31',
      q: 'coffee',
    })

    const [path] = authenticatedRequestMock.mock.calls[0]
    const params = new URL(path, 'http://localhost').searchParams
    expect(path.startsWith('/transactions/export?')).toBe(true)
    expect(params.getAll('account_id')).toEqual(['acc_1', 'acc_2'])
    expect(params.getAll('tag_id')).toEqual(['tag_1', 'tag_2'])
    expect(params.get('tag_match')).toBe('any')
    expect(params.get('min_amount')).toBe('500')
    expect(params.get('amount_currency')).toBe('CAD')
    expect(params.get('from_date')).toBe('2026-01-01')
    expect(params.get('to_date')).toBe('2026-01-31')
    expect(params.get('q')).toBe('coffee')
  })

  it('asks for the file without a query string when nothing is filtered', async () => {
    await fetchTransactionsCsv({})

    expect(authenticatedRequestMock.mock.calls[0][0]).toBe('/transactions/export')
  })

  it('waits longer than an ordinary request and returns the file body', async () => {
    const file = await fetchTransactionsCsv({})

    expect(authenticatedRequestMock.mock.calls[0][1].timeoutMs).toBeGreaterThan(30_000)
    expect(await file.text()).toBe('Date,Merchant\r\n')
  })
})
