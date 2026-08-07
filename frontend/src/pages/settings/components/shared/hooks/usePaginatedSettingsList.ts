import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'

// Held long enough that the first load's overlay and the fetch-more message do not flash on a fast
// connection, before the fetched page is old enough to reveal on its own
const INITIAL_LOAD_MIN_MS = 300
const FETCHING_MORE_TEXT_MIN_MS = 800

// Distance in pixels from the end of the scroll container still counted as "at the bottom",
// absorbing the sub-pixel rounding browsers apply to scroll measurements
const SCROLL_BOTTOM_THRESHOLD_PX = 4

// Fraction of the container's visible height to scroll on a "show more" click, short of a full
// page so the next row lands in view instead of jumping past it
const LOAD_MORE_CLICK_SCROLL_FRACTION = 0.45

interface InfiniteListQueryResult<TItem> {
  data?: { pages: TItem[][] }
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage?: boolean
  fetchNextPage: () => void
}

interface UsePaginatedSettingsListParams<TItem extends { id: string }> {
  /** React Query infinite-list hook for the domain, called with the active search text and the page size */
  useInfiniteListQuery: (filters: { q?: string }, pageSize: number) => InfiniteListQueryResult<TItem>
  pageSize: number
  visibleRowCount: number
  searchDebounceMs: number
  locallyDeletedIds: string[]
  /** Fields whose change should re-reveal a row, such as an inline edit changing a displayed value */
  getItemIdentityKey: (item: TItem) => readonly unknown[]
  /** Reorders a fetched page before it is compared against what is on screen, for a list the server does not already return in display order */
  sortFetchedItems?: (items: TItem[]) => TItem[]
}

/**
 * Drives a paginated, searchable settings list: an infinite query, minimum-visible-time gating on
 * the first load's flag and the fetching-more message, deferred reveal of a fetched page,
 * scroll-to-bottom detection, local-deletion filtering and a debounced search
 *
 * Whether new data counts as an appended page is tracked by a flag set when the caller asks for
 * more, rather than inferred from a growing list, so a background refetch that happens to grow
 * the row count is not mistaken for a requested page
 */
export function usePaginatedSettingsList<TItem extends { id: string }>({
  useInfiniteListQuery,
  pageSize,
  visibleRowCount,
  searchDebounceMs,
  locallyDeletedIds,
  getItemIdentityKey,
  sortFetchedItems,
}: UsePaginatedSettingsListParams<TItem>) {
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const listQuery = useInfiniteListQuery({ q: activeSearch.trim() || undefined }, pageSize)
  const [visibleItems, setVisibleItems] = useState<TItem[]>([])
  const [listAtBottom, setListAtBottom] = useState(false)
  const [pageFetchPending, setPageFetchPending] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const visibleItemCountRef = useRef(0)
  const initialFetchStartedAtRef = useRef<number | null>(null)
  const fetchMoreStartedAtRef = useRef<number | null>(null)

  const locallyDeletedIdSet = useMemo(() => new Set(locallyDeletedIds), [locallyDeletedIds])
  const fetchedItems = useMemo(() => {
    const items = (listQuery.data?.pages.flat() ?? [])
      .filter((item) => !locallyDeletedIdSet.has(item.id))
    return sortFetchedItems ? sortFetchedItems(items) : items
  }, [listQuery.data, locallyDeletedIdSet, sortFetchedItems])
  const fetchedItemKey = useMemo(
    () => JSON.stringify(fetchedItems.map(getItemIdentityKey)),
    [fetchedItems, getItemIdentityKey],
  )
  const visibleItemKey = useMemo(
    () => JSON.stringify(visibleItems.map(getItemIdentityKey)),
    [visibleItems, getItemIdentityKey],
  )
  const hasUndisplayedFetchedItems = (
    fetchedItemKey !== visibleItemKey &&
    fetchedItems.length > visibleItems.length &&
    visibleItems.length > 0 &&
    pageFetchPending
  )
  const showInitialLoading = useMinimumVisibleFlag(listQuery.isLoading, INITIAL_LOAD_MIN_MS)
  const showFetchingMore = useMinimumVisibleFlag(
    listQuery.isFetchingNextPage || hasUndisplayedFetchedItems,
    FETCHING_MORE_TEXT_MIN_MS,
  )
  const hasMore = !!listQuery.hasNextPage
  const canFetchMore = hasMore && !listQuery.isFetchingNextPage && !showFetchingMore
  const shouldScroll = (
    visibleItems.length >= visibleRowCount &&
    (hasMore || visibleItems.length > visibleRowCount || showFetchingMore)
  )
  const showListMoreIndicator = shouldScroll && !listAtBottom && !showFetchingMore
  const showListEnd = shouldScroll && !hasMore && listAtBottom

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setActiveSearch(search)
    }, searchDebounceMs)

    return () => window.clearTimeout(timeoutId)
  }, [search, searchDebounceMs])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisibleItems([])
      setListAtBottom(false)
      visibleItemCountRef.current = 0
      initialFetchStartedAtRef.current = performance.now()
      fetchMoreStartedAtRef.current = null
      if (listRef.current) listRef.current.scrollTop = 0
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearch])

  useEffect(() => {
    visibleItemCountRef.current = visibleItems.length
  }, [visibleItems.length])

  useEffect(() => {
    if (listQuery.isLoading) {
      initialFetchStartedAtRef.current = performance.now()
    }
  }, [listQuery.isLoading])

  useEffect(() => {
    if (listQuery.isFetchingNextPage) {
      fetchMoreStartedAtRef.current = performance.now()
    }
  }, [listQuery.isFetchingNextPage])

  useEffect(() => {
    if (fetchedItemKey === visibleItemKey) return undefined

    const isAppendingPage = (
      fetchedItems.length > visibleItemCountRef.current &&
      visibleItemCountRef.current > 0 &&
      pageFetchPending
    )
    const isInitialPage = fetchedItems.length > 0 && visibleItemCountRef.current === 0
    const now = performance.now()
    const fetchStartedAt = isAppendingPage
      ? fetchMoreStartedAtRef.current
      : initialFetchStartedAtRef.current
    const elapsed = fetchStartedAt === null ? INITIAL_LOAD_MIN_MS : now - fetchStartedAt
    const shouldDelay = isAppendingPage || isInitialPage
    const minimumVisibleMs = isAppendingPage ? FETCHING_MORE_TEXT_MIN_MS : INITIAL_LOAD_MIN_MS
    const delayMs = shouldDelay ? Math.max(minimumVisibleMs - elapsed, 0) : 0
    const timeoutId = window.setTimeout(() => {
      setVisibleItems(fetchedItems)
      if (isInitialPage) initialFetchStartedAtRef.current = null
      if (isAppendingPage) {
        fetchMoreStartedAtRef.current = null
        setPageFetchPending(false)
      }
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [fetchedItemKey, fetchedItems, pageFetchPending, visibleItemKey])

  useEffect(() => {
    if (!pageFetchPending || listQuery.isFetchingNextPage || fetchedItemKey !== visibleItemKey) return undefined

    const frame = window.requestAnimationFrame(() => setPageFetchPending(false))
    return () => window.cancelAnimationFrame(frame)
  }, [fetchedItemKey, pageFetchPending, listQuery.isFetchingNextPage, visibleItemKey])

  useEffect(() => {
    if (hasMore || !shouldScroll) return

    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current
      if (!list) return

      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX
      if (atBottom) setListAtBottom(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasMore, shouldScroll, visibleItems.length])

  const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - SCROLL_BOTTOM_THRESHOLD_PX
    if (!atBottom) {
      setListAtBottom(false)
      return
    }

    if (canFetchMore) {
      fetchMoreStartedAtRef.current = performance.now()
      setPageFetchPending(true)
      listQuery.fetchNextPage()
      setListAtBottom(false)
    } else if (!hasMore && !showFetchingMore) {
      setListAtBottom(true)
    }
  }

  const handleListMoreClick = () => {
    setListAtBottom(false)
    window.requestAnimationFrame(() => {
      const list = listRef.current
      if (!list) return

      const maxScrollTop = list.scrollHeight - list.clientHeight
      if (list.scrollTop >= maxScrollTop - SCROLL_BOTTOM_THRESHOLD_PX) {
        if (canFetchMore) {
          fetchMoreStartedAtRef.current = performance.now()
          setPageFetchPending(true)
          listQuery.fetchNextPage()
        }
        return
      }

      list.scrollBy({ top: list.clientHeight * LOAD_MORE_CLICK_SCROLL_FRACTION, behavior: 'smooth' })
    })
  }

  return {
    activeSearch,
    handleListMoreClick,
    handleListScroll,
    hasMore,
    listRef,
    search,
    setActiveSearch,
    setSearch,
    setVisibleItems,
    shouldScroll,
    showFetchingMore,
    showInitialLoading,
    showListEnd,
    showListMoreIndicator,
    visibleItems,
  }
}
