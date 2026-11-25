import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'

interface PagedReferenceQuery<TItem> {
  data?: { pages: TItem[][] }
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage?: boolean
  fetchNextPage: () => Promise<unknown>
}

interface PagedReferenceDropdownOptions<TItem extends { id: string }> {
  query: PagedReferenceQuery<TItem>
  activeSearchText: string
  searchLoadingMinMs: number
  fetchingMoreMinMs: number
  idleLoadingText: string
}

interface PagedReferenceDropdownState<TItem> {
  fetchedItems: TItem[]
  visibleItems: TItem[]

  /** True once the items on show belong to the active search, not to the search before it */
  answersSearch: boolean
  showInitialLoading: boolean
  showFetchingMore: boolean
  showLoading: boolean
  loadingText: string
  loadMore: () => void
}

/**
 * Keeps reference dropdown pages visually stable while remote search and pagination results settle
 */
export function usePagedReferenceDropdown<TItem extends { id: string }>({
  query,
  activeSearchText,
  searchLoadingMinMs,
  fetchingMoreMinMs,
  idleLoadingText,
}: PagedReferenceDropdownOptions<TItem>): PagedReferenceDropdownState<TItem> {
  // The items on show and the search text they answer, set together so a render never holds one of the
  // two from before a search and the other from after it
  const [visible, setVisible] = useState<{ items: TItem[]; searchText: string }>({ items: [], searchText: '' })
  const { items: visibleItems, searchText: visibleSearchText } = visible
  const visibleItemCountRef = useRef(0)
  const initialFetchStartedAtRef = useRef<number | null>(null)
  const fetchMoreStartedAtRef = useRef<number | null>(null)
  const showFetchingMore = useMinimumVisibleFlag(query.isFetchingNextPage, fetchingMoreMinMs)
  const showInitialLoading = useMinimumVisibleFlag(query.isLoading, searchLoadingMinMs)
  const showLoading = showInitialLoading || showFetchingMore
  const loadingText = showFetchingMore
    ? 'Fetching more'
    : activeSearchText
      ? `Searching for ${activeSearchText}`
      : idleLoadingText
  const fetchedItems = useMemo(() => query.data?.pages.flat() ?? [], [query.data])
  const fetchedItemKey = useMemo(() => buildItemKey(fetchedItems), [fetchedItems])
  const visibleItemKey = useMemo(() => buildItemKey(visibleItems), [visibleItems])

  useEffect(() => {
    visibleItemCountRef.current = visibleItems.length
  }, [visibleItems.length])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!activeSearchText) {
        initialFetchStartedAtRef.current = null
        fetchMoreStartedAtRef.current = null
        return
      }

      setVisible({ items: [], searchText: activeSearchText })
      visibleItemCountRef.current = 0
      initialFetchStartedAtRef.current = performance.now()
      fetchMoreStartedAtRef.current = null
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearchText])

  useLayoutEffect(() => {
    if (activeSearchText) return
    if (query.isFetchingNextPage || fetchMoreStartedAtRef.current !== null) return
    if (fetchedItemKey === visibleItemKey && visibleSearchText === activeSearchText) return

    const frame = window.requestAnimationFrame(() => {
      setVisible({ items: fetchedItems, searchText: activeSearchText })
      visibleItemCountRef.current = fetchedItems.length
      initialFetchStartedAtRef.current = null
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearchText, fetchedItemKey, fetchedItems, query.isFetchingNextPage, visibleItemKey, visibleSearchText])

  useEffect(() => {
    if (query.isLoading) {
      initialFetchStartedAtRef.current = performance.now()
    }
  }, [query.isLoading])

  useEffect(() => {
    if (query.isFetchingNextPage) {
      fetchMoreStartedAtRef.current = performance.now()
    }
  }, [query.isFetchingNextPage])

  useEffect(() => {
    if (fetchedItemKey === visibleItemKey && visibleSearchText === activeSearchText) return undefined

    const isAppendingPage = fetchedItems.length > visibleItemCountRef.current && visibleItemCountRef.current > 0
    const isInitialPage = fetchedItems.length > 0 && visibleItemCountRef.current === 0
    const fetchStartedAt = isAppendingPage ? fetchMoreStartedAtRef.current : initialFetchStartedAtRef.current
    const minimumVisibleMs = isAppendingPage ? fetchingMoreMinMs : searchLoadingMinMs
    const elapsed = fetchStartedAt === null ? minimumVisibleMs : performance.now() - fetchStartedAt
    const delayMs = Math.max(minimumVisibleMs - elapsed, 0)
    const timeoutId = window.setTimeout(() => {
      setVisible({ items: fetchedItems, searchText: activeSearchText })
      if (isInitialPage) initialFetchStartedAtRef.current = null
      if (isAppendingPage) fetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [
    activeSearchText,
    fetchedItemKey,
    fetchedItems,
    fetchingMoreMinMs,
    searchLoadingMinMs,
    visibleItemKey,
    visibleSearchText,
  ])

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage || showFetchingMore) return
    void query.fetchNextPage()
  }, [query, showFetchingMore])

  return {
    fetchedItems,
    visibleItems,
    answersSearch: visibleSearchText === activeSearchText,
    showInitialLoading,
    showFetchingMore,
    showLoading,
    loadingText,
    loadMore,
  }
}

function buildItemKey<TItem extends { id: string }>(items: TItem[]) {
  return items.map((item) => item.id).join('|')
}
