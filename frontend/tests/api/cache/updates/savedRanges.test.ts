/**
 * Tests the saved-range cache writes a save or a delete relies on, so a range appears and leaves the
 * list in place while the pages are read again
 *
 * The mutations that call these need a live React tree, so this covers the writes directly against a
 * real QueryClient
 */
import { describe, expect, it } from 'vitest'
import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import { insightsKeys } from '@/api/cache/queryKeys'
import { addCachedSavedRange, removeCachedSavedRange } from '@/api/cache/updates/savedRanges'
import type { SavedInsightsRange } from '@/api/insights'

function savedRange(id: string): SavedInsightsRange {
  return { id, name: id, amount: 6, unit: 'month', qualifier: 'past', created_at: '2026-01-01T00:00:00Z' }
}

const pagesKey = insightsKeys.savedRangesPages(50)

function seed(queryClient: QueryClient, pages: SavedInsightsRange[][]) {
  queryClient.setQueryData<InfiniteData<SavedInsightsRange[], number>>(pagesKey, {
    pages,
    pageParams: pages.map((_, index) => index * 50),
  })
}

function idsOf(queryClient: QueryClient) {
  return queryClient
    .getQueryData<InfiniteData<SavedInsightsRange[]>>(pagesKey)
    ?.pages.map((page) => page.map((range) => range.id))
}

describe('addCachedSavedRange', () => {
  it('puts the new range at the head of the first page and leaves the later pages alone', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [[savedRange('b')], [savedRange('a')]])

    addCachedSavedRange(queryClient, savedRange('c'))

    expect(idsOf(queryClient)).toEqual([['c', 'b'], ['a']])
  })

  it('marks the pages for a fresh read, since the page boundaries have moved', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [[savedRange('b')]])

    addCachedSavedRange(queryClient, savedRange('c'))

    expect(queryClient.getQueryState(pagesKey)?.isInvalidated).toBe(true)
  })

  it('writes nothing for pages that were never read', () => {
    const queryClient = new QueryClient()

    addCachedSavedRange(queryClient, savedRange('c'))

    expect(queryClient.getQueryData(pagesKey)).toBeUndefined()
  })
})

describe('removeCachedSavedRange', () => {
  it('takes the range out of whichever page holds it', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [[savedRange('c'), savedRange('b')], [savedRange('a')]])

    removeCachedSavedRange(queryClient, 'a')

    expect(idsOf(queryClient)).toEqual([['c', 'b'], []])
  })

  it('marks the pages for a fresh read, which fills the page the range left', () => {
    const queryClient = new QueryClient()
    seed(queryClient, [[savedRange('b')]])

    removeCachedSavedRange(queryClient, 'b')

    expect(queryClient.getQueryState(pagesKey)?.isInvalidated).toBe(true)
  })
})
