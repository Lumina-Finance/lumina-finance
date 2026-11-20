/**
 * Covers institution API request functions used by account creation, identity edits and
 * the correction a user submits to an institution
 *
 * These tests catch regressions where institution list, create and correction requests
 * call the wrong endpoint or send a malformed payload
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import { createInstitution, fetchInstitution, fetchInstitutionsPage, updateInstitution } from '@/api/institutions'

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue({})
})

describe('institution API functions', () => {
  it('asks for the first page of fifty when no filters or size are given, never the whole table', async () => {
    await fetchInstitutionsPage()

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/institutions?limit=50&offset=0', expect.anything())
  })

  it('sends the search text with the page it asks for', async () => {
    await fetchInstitutionsPage({ q: 'credit union' }, 50, 100)

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/institutions?q=credit+union&limit=50&offset=100',
      expect.anything(),
    )
  })

  it('reads one institution by its ID', async () => {
    await fetchInstitution('11111111-1111-1111-1111-111111111111')

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/institutions/11111111-1111-1111-1111-111111111111',
      expect.anything(),
    )
  })

  it('creates institutions with country and website fields', async () => {
    await createInstitution({
      name: 'Alpha Bank',
      country_code: 'CA',
      website: 'https://alpha.example.com',
    })

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/institutions', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Alpha Bank',
        country_code: 'CA',
        website: 'https://alpha.example.com',
      }),
    })
  })

  it('sends a correction to the institution being corrected, carrying only the fields given', async () => {
    await updateInstitution({
      institutionId: '11111111-1111-1111-1111-111111111111',
      payload: { website: 'https://alpha.example.com' },
    })

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/institutions/11111111-1111-1111-1111-111111111111', {
      method: 'PATCH',
      body: JSON.stringify({ website: 'https://alpha.example.com' }),
    })
  })
})
