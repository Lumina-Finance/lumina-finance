import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { insightsKeys } from '@/api/cache/queryKeys'
import type { SavedInsightsRange } from '@/api/insights/types'

type SavedRangePages = InfiniteData<SavedInsightsRange[], number>

/**
 * Re-reads the pages of saved ranges that are on screen, so the order and page boundaries are the
 * server's once an edit made in place has done its job
 */
export function invalidateSavedRangePages(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: insightsKeys.savedRangesPagesAll, refetchType: 'active' })
}

/**
 * Puts a range just saved at the head of the loaded pages, where the newest-first order has it, so
 * it eases into the list before the pages are read again
 */
export function addCachedSavedRange(queryClient: QueryClient, savedRange: SavedInsightsRange) {
  queryClient.setQueriesData<SavedRangePages>({ queryKey: insightsKeys.savedRangesPagesAll }, (cached) => {
    if (!cached) return cached
    const [firstPage = [], ...laterPages] = cached.pages
    return { ...cached, pages: [[savedRange, ...firstPage], ...laterPages] }
  })
  invalidateSavedRangePages(queryClient)
}

/**
 * Takes a deleted range out of the loaded pages in place, so its row leaves the list at once
 * and the pages are read again afterwards
 */
export function removeCachedSavedRange(queryClient: QueryClient, rangeId: string) {
  queryClient.setQueriesData<SavedRangePages>(
    { queryKey: insightsKeys.savedRangesPagesAll },
    (cached) =>
      cached && {
        ...cached,
        pages: cached.pages.map((page) => page.filter((range) => range.id !== rangeId)),
      },
  )
  invalidateSavedRangePages(queryClient)
}
