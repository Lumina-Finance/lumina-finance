import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import {
  useInfiniteMerchants,
  type Merchant,
} from '@/api/merchants'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import {
  FETCHING_MORE_TEXT_MIN_MS,
  LOADING_TEXT_MIN_MS,
  MERCHANT_LIST_PAGE_SIZE,
  MERCHANT_LIST_VISIBLE_ROWS,
  MERCHANT_SEARCH_DEBOUNCE_MS,
} from '@/pages/settings/components/merchant-settings-section/constants'

/**
 * Drives the paginated, searchable merchant list, revealing fetched pages only after a minimum
 * loading time so the loading and fetching-more messages do not flash on a fast connection
 *
 * A locally deleted merchant is filtered out of the fetched results immediately, before the next
 * server refetch catches up, so a deletion does not reappear in the list for a moment
 */
export function useMerchantSettingsList(locallyDeletedMerchantIds: string[]) {
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const merchantQuery = useInfiniteMerchants(
    { q: activeSearch.trim() || undefined },
    MERCHANT_LIST_PAGE_SIZE,
  )
  const [visibleMerchants, setVisibleMerchants] = useState<Merchant[]>([])
  const [merchantListAtBottom, setMerchantListAtBottom] = useState(false)
  const merchantListRef = useRef<HTMLDivElement | null>(null)
  const visibleMerchantCountRef = useRef(0)
  const initialFetchStartedAtRef = useRef<number | null>(null)
  const fetchMoreStartedAtRef = useRef<number | null>(null)

  const locallyDeletedMerchantIdSet = useMemo(
    () => new Set(locallyDeletedMerchantIds),
    [locallyDeletedMerchantIds],
  )
  // Preserve the server's order, recent usage then name, so appended pages keep the rows already on
  // screen in place. Re-sorting here would interleave each new page among the loaded rows and
  // reshuffle the list on every load
  const fetchedMerchants = useMemo(
    () => (merchantQuery.data?.pages.flat() ?? [])
      .filter((merchant) => !locallyDeletedMerchantIdSet.has(merchant.id)),
    [locallyDeletedMerchantIdSet, merchantQuery.data],
  )
  const fetchedMerchantKey = useMemo(
    () => JSON.stringify(fetchedMerchants.map((merchant) => [
      merchant.id,
      merchant.name,
      merchant.default_category_id,
    ])),
    [fetchedMerchants],
  )
  const visibleMerchantKey = useMemo(
    () => JSON.stringify(visibleMerchants.map((merchant) => [
      merchant.id,
      merchant.name,
      merchant.default_category_id,
    ])),
    [visibleMerchants],
  )
  const hasUndisplayedFetchedMerchants = (
    fetchedMerchantKey !== visibleMerchantKey &&
    fetchedMerchants.length > visibleMerchants.length &&
    visibleMerchants.length > 0
  )
  const showInitialMerchantLoading = useMinimumVisibleFlag(
    merchantQuery.isLoading,
    LOADING_TEXT_MIN_MS,
  )
  const showFetchingMoreMerchants = useMinimumVisibleFlag(
    merchantQuery.isFetchingNextPage || hasUndisplayedFetchedMerchants,
    FETCHING_MORE_TEXT_MIN_MS,
  )
  const hasMoreMerchants = !!merchantQuery.hasNextPage
  const canFetchMoreMerchants = hasMoreMerchants && !merchantQuery.isFetchingNextPage && !showFetchingMoreMerchants
  const shouldScrollMerchants = (
    visibleMerchants.length >= MERCHANT_LIST_VISIBLE_ROWS &&
    (hasMoreMerchants || visibleMerchants.length > MERCHANT_LIST_VISIBLE_ROWS || showFetchingMoreMerchants)
  )
  const showMerchantListMoreIndicator = shouldScrollMerchants && !merchantListAtBottom && !showFetchingMoreMerchants
  const showMerchantListEnd = shouldScrollMerchants && !hasMoreMerchants && merchantListAtBottom

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setActiveSearch(search)
    }, MERCHANT_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [search])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisibleMerchants([])
      setMerchantListAtBottom(false)
      visibleMerchantCountRef.current = 0
      initialFetchStartedAtRef.current = performance.now()
      fetchMoreStartedAtRef.current = null
      if (merchantListRef.current) merchantListRef.current.scrollTop = 0
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearch])

  useEffect(() => {
    visibleMerchantCountRef.current = visibleMerchants.length
  }, [visibleMerchants.length])

  useEffect(() => {
    if (merchantQuery.isLoading) {
      initialFetchStartedAtRef.current = performance.now()
    }
  }, [merchantQuery.isLoading])

  useEffect(() => {
    if (merchantQuery.isFetchingNextPage) {
      fetchMoreStartedAtRef.current = performance.now()
    }
  }, [merchantQuery.isFetchingNextPage])

  useEffect(() => {
    if (fetchedMerchantKey === visibleMerchantKey) return undefined

    const isAppendingPage = fetchedMerchants.length > visibleMerchantCountRef.current && visibleMerchantCountRef.current > 0
    const isInitialPage = fetchedMerchants.length > 0 && visibleMerchantCountRef.current === 0
    const now = performance.now()
    const fetchStartedAt = isAppendingPage
      ? fetchMoreStartedAtRef.current
      : initialFetchStartedAtRef.current
    const elapsed = fetchStartedAt === null ? LOADING_TEXT_MIN_MS : now - fetchStartedAt
    const shouldDelay = isAppendingPage || isInitialPage
    const minimumVisibleMs = isAppendingPage ? FETCHING_MORE_TEXT_MIN_MS : LOADING_TEXT_MIN_MS
    const delayMs = shouldDelay ? Math.max(minimumVisibleMs - elapsed, 0) : 0
    const timeoutId = window.setTimeout(() => {
      setVisibleMerchants(fetchedMerchants)
      if (isInitialPage) initialFetchStartedAtRef.current = null
      if (isAppendingPage) fetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [fetchedMerchantKey, fetchedMerchants, visibleMerchantKey])

  useEffect(() => {
    if (hasMoreMerchants || !shouldScrollMerchants) return

    const frame = window.requestAnimationFrame(() => {
      const list = merchantListRef.current
      if (!list) return

      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
      if (atBottom) setMerchantListAtBottom(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasMoreMerchants, shouldScrollMerchants, visibleMerchants.length])

  const handleMerchantListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    if (!atBottom) {
      setMerchantListAtBottom(false)
      return
    }

    if (canFetchMoreMerchants) {
      fetchMoreStartedAtRef.current = performance.now()
      merchantQuery.fetchNextPage()
      setMerchantListAtBottom(false)
    } else if (!hasMoreMerchants && !showFetchingMoreMerchants) {
      setMerchantListAtBottom(true)
    }
  }

  const handleMerchantListMoreClick = () => {
    setMerchantListAtBottom(false)
    window.requestAnimationFrame(() => {
      const list = merchantListRef.current
      if (!list) return

      const maxScrollTop = list.scrollHeight - list.clientHeight
      if (list.scrollTop >= maxScrollTop - 4) {
        if (canFetchMoreMerchants) {
          fetchMoreStartedAtRef.current = performance.now()
          merchantQuery.fetchNextPage()
        }
        return
      }

      list.scrollBy({ top: list.clientHeight * 0.45, behavior: 'smooth' })
    })
  }

  return {
    activeSearch,
    handleMerchantListMoreClick,
    handleMerchantListScroll,
    hasMoreMerchants,
    search,
    setActiveSearch,
    setSearch,
    setVisibleMerchants,
    shouldScrollMerchants,
    showFetchingMoreMerchants,
    showInitialMerchantLoading,
    showMerchantListEnd,
    showMerchantListMoreIndicator,
    merchantListRef,
    visibleMerchants,
  }
}
