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
  const [visibleItems, setVisibleItems] = useState<TItem[]>([])
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

      setVisibleItems([])
      visibleItemCountRef.current = 0
      initialFetchStartedAtRef.current = performance.now()
      fetchMoreStartedAtRef.current = null
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearchText])

  useLayoutEffect(() => {
    if (activeSearchText) return
    if (query.isFetchingNextPage || fetchMoreStartedAtRef.current !== null) return
    if (fetchedItemKey === visibleItemKey) return

    const frame = window.requestAnimationFrame(() => {
      setVisibleItems(fetchedItems)
      visibleItemCountRef.current = fetchedItems.length
      initialFetchStartedAtRef.current = null
    })

    return () => window.cancelAnimationFrame(frame)
  }, [
    activeSearchText,
    fetchedItemKey,
    fetchedItems,
    query.isFetchingNextPage,
    visibleItemKey,
  ])

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
    if (fetchedItemKey === visibleItemKey) return undefined

    const isAppendingPage = fetchedItems.length > visibleItemCountRef.current && visibleItemCountRef.current > 0
    const isInitialPage = fetchedItems.length > 0 && visibleItemCountRef.current === 0
    const fetchStartedAt = isAppendingPage
      ? fetchMoreStartedAtRef.current
      : initialFetchStartedAtRef.current
    const minimumVisibleMs = isAppendingPage
      ? fetchingMoreMinMs
      : searchLoadingMinMs
    const elapsed = fetchStartedAt === null ? minimumVisibleMs : performance.now() - fetchStartedAt
    const delayMs = Math.max(minimumVisibleMs - elapsed, 0)
    const timeoutId = window.setTimeout(() => {
      setVisibleItems(fetchedItems)
      if (isInitialPage) initialFetchStartedAtRef.current = null
      if (isAppendingPage) fetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [
    fetchedItemKey,
    fetchedItems,
    fetchingMoreMinMs,
    searchLoadingMinMs,
    visibleItemKey,
  ])

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage || showFetchingMore) return
    void query.fetchNextPage()
  }, [query, showFetchingMore])

  return {
    fetchedItems,
    visibleItems,
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
