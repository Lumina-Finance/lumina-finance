/**
 * Tests the institution cache writes a creation or a correction relies on to reach the screen
 *
 * useCreateInstitution and useUpdateInstitution call useMutation and useQueryClient. Both need a
 * live React tree to invoke, so this covers the cache updates directly against a real QueryClient
 */
import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { Institution } from '@/api/institutions'
import { accountKeys, institutionKeys } from '@/api/cache/queryKeys'
import { updateCachedInstitution, updateCreatedInstitution } from '@/api/cache/updates/institutions'

/**
 * Creates an institution fixture, defaulting the fields a correction does not exercise
 */
function createInstitution(overrides: Partial<Institution> = {}): Institution {
  return {
    id: 'alpha',
    status: 'pending',
    name: 'Alpha Bank',
    country_code: 'CA',
    website: 'https://alpha.example.com',
    logo_url: null,
    ...overrides,
  }
}

function isInvalidated(queryClient: QueryClient, queryKey: readonly unknown[]) {
  return queryClient.getQueryCache().find({ queryKey, exact: true })?.state.isInvalidated
}

describe('updateCreatedInstitution', () => {
  it('caches the created institution by its ID so a picker names it without a request', () => {
    const queryClient = new QueryClient()
    const created = createInstitution({ id: 'new', name: 'New Bank' })

    updateCreatedInstitution(queryClient, created)

    expect(queryClient.getQueryData(institutionKeys.detail('new'))).toEqual(created)
  })

  it('refreshes every held page and search, since the new institution belongs in the name order', () => {
    const queryClient = new QueryClient()
    const firstPage = institutionKeys.infinite({}, 50)
    const searched = institutionKeys.infinite({ q: 'new' }, 50)
    queryClient.setQueryData(firstPage, { pages: [[createInstitution()]], pageParams: [0] })
    queryClient.setQueryData(searched, { pages: [[]], pageParams: [0] })

    updateCreatedInstitution(queryClient, createInstitution({ id: 'new', name: 'New Bank' }))

    expect(isInvalidated(queryClient, firstPage)).toBe(true)
    expect(isInvalidated(queryClient, searched)).toBe(true)
  })
})

describe('updateCachedInstitution', () => {
  it('replaces the cached record of a corrected institution', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(institutionKeys.detail('alpha'), createInstitution())

    updateCachedInstitution(queryClient, createInstitution({ name: 'Aaa Bank' }))

    expect(queryClient.getQueryData<Institution>(institutionKeys.detail('alpha'))?.name).toBe('Aaa Bank')
  })

  it('refreshes the held pages, since the server sorted them by the name that has just changed', () => {
    const queryClient = new QueryClient()
    const firstPage = institutionKeys.infinite({}, 50)
    queryClient.setQueryData(firstPage, { pages: [[createInstitution()]], pageParams: [0] })

    updateCachedInstitution(queryClient, createInstitution({ name: 'Aaa Bank' }))

    expect(isInvalidated(queryClient, firstPage)).toBe(true)
  })

  it('invalidates the accounts that embed the corrected institution', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(accountKeys.list(), [])

    updateCachedInstitution(queryClient, createInstitution())

    expect(isInvalidated(queryClient, accountKeys.list())).toBe(true)
  })
})
