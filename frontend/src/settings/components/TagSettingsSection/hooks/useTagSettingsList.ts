import { useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { useInfiniteTags, type Tag } from '@/api/tags'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import {
  FETCHING_MORE_TEXT_MIN_MS,
  LOADING_TEXT_MIN_MS,
  TAG_LIST_PAGE_SIZE,
  TAG_LIST_VISIBLE_ROWS,
  TAG_SEARCH_DEBOUNCE_MS,
} from '@/settings/components/TagSettingsSection/tagSettingsConstants'

export function useTagSettingsList(locallyDeletedTagIds: string[]) {
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const tagQuery = useInfiniteTags(
    { q: activeSearch.trim() || undefined },
    TAG_LIST_PAGE_SIZE,
  )
  const [visibleTags, setVisibleTags] = useState<Tag[]>([])
  const [tagListAtBottom, setTagListAtBottom] = useState(false)
  const tagListRef = useRef<HTMLDivElement | null>(null)
  const visibleTagCountRef = useRef(0)
  const initialFetchStartedAtRef = useRef<number | null>(null)
  const fetchMoreStartedAtRef = useRef<number | null>(null)

  const locallyDeletedTagIdSet = useMemo(
    () => new Set(locallyDeletedTagIds),
    [locallyDeletedTagIds],
  )
  const fetchedTags = useMemo(
    () => (tagQuery.data?.pages.flat() ?? [])
      .filter((tag) => !locallyDeletedTagIdSet.has(tag.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
    [locallyDeletedTagIdSet, tagQuery.data],
  )
  const fetchedTagKey = useMemo(
    () => fetchedTags.map((tag) => tag.id).join('|'),
    [fetchedTags],
  )
  const visibleTagKey = useMemo(
    () => visibleTags.map((tag) => tag.id).join('|'),
    [visibleTags],
  )
  const hasUndisplayedFetchedTags = (
    fetchedTagKey !== visibleTagKey &&
    fetchedTags.length > visibleTags.length &&
    visibleTags.length > 0
  )
  const showInitialTagLoading = useMinimumVisibleFlag(
    tagQuery.isLoading,
    LOADING_TEXT_MIN_MS,
  )
  const showFetchingMoreTags = useMinimumVisibleFlag(
    tagQuery.isFetchingNextPage || hasUndisplayedFetchedTags,
    FETCHING_MORE_TEXT_MIN_MS,
  )
  const hasMoreTags = !!tagQuery.hasNextPage
  const canFetchMoreTags = hasMoreTags && !tagQuery.isFetchingNextPage && !showFetchingMoreTags
  const shouldScrollTags = (
    visibleTags.length >= TAG_LIST_VISIBLE_ROWS &&
    (hasMoreTags || visibleTags.length > TAG_LIST_VISIBLE_ROWS || showFetchingMoreTags)
  )
  const showTagListMoreIndicator = shouldScrollTags && !tagListAtBottom && !showFetchingMoreTags
  const showTagListEnd = shouldScrollTags && !hasMoreTags && tagListAtBottom

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setActiveSearch(search)
    }, TAG_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [search])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisibleTags([])
      setTagListAtBottom(false)
      visibleTagCountRef.current = 0
      initialFetchStartedAtRef.current = performance.now()
      fetchMoreStartedAtRef.current = null
      if (tagListRef.current) tagListRef.current.scrollTop = 0
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearch])

  useEffect(() => {
    visibleTagCountRef.current = visibleTags.length
  }, [visibleTags.length])

  useEffect(() => {
    if (tagQuery.isLoading) {
      initialFetchStartedAtRef.current = performance.now()
    }
  }, [tagQuery.isLoading])

  useEffect(() => {
    if (tagQuery.isFetchingNextPage) {
      fetchMoreStartedAtRef.current = performance.now()
    }
  }, [tagQuery.isFetchingNextPage])

  useEffect(() => {
    if (fetchedTagKey === visibleTagKey) return undefined

    const isAppendingPage = fetchedTags.length > visibleTagCountRef.current && visibleTagCountRef.current > 0
    const isInitialPage = fetchedTags.length > 0 && visibleTagCountRef.current === 0
    const now = performance.now()
    const fetchStartedAt = isAppendingPage
      ? fetchMoreStartedAtRef.current
      : initialFetchStartedAtRef.current
    const elapsed = fetchStartedAt === null ? LOADING_TEXT_MIN_MS : now - fetchStartedAt
    const shouldDelay = isAppendingPage || isInitialPage
    const minimumVisibleMs = isAppendingPage ? FETCHING_MORE_TEXT_MIN_MS : LOADING_TEXT_MIN_MS
    const delayMs = shouldDelay ? Math.max(minimumVisibleMs - elapsed, 0) : 0
    const timeoutId = window.setTimeout(() => {
      setVisibleTags(fetchedTags)
      if (isInitialPage) initialFetchStartedAtRef.current = null
      if (isAppendingPage) fetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [fetchedTagKey, fetchedTags, visibleTagKey])

  useEffect(() => {
    if (hasMoreTags || !shouldScrollTags) return

    const frame = window.requestAnimationFrame(() => {
      const list = tagListRef.current
      if (!list) return

      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
      if (atBottom) setTagListAtBottom(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasMoreTags, shouldScrollTags, visibleTags.length])

  const handleTagListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    if (!atBottom) {
      setTagListAtBottom(false)
      return
    }

    if (canFetchMoreTags) {
      fetchMoreStartedAtRef.current = performance.now()
      tagQuery.fetchNextPage()
      setTagListAtBottom(false)
    } else if (!hasMoreTags && !showFetchingMoreTags) {
      setTagListAtBottom(true)
    }
  }

  const handleTagListMoreClick = () => {
    setTagListAtBottom(false)
    window.requestAnimationFrame(() => {
      const list = tagListRef.current
      if (!list) return

      const maxScrollTop = list.scrollHeight - list.clientHeight
      if (list.scrollTop >= maxScrollTop - 4) {
        if (canFetchMoreTags) {
          fetchMoreStartedAtRef.current = performance.now()
          tagQuery.fetchNextPage()
        }
        return
      }

      list.scrollBy({ top: list.clientHeight * 0.45, behavior: 'smooth' })
    })
  }

  return {
    activeSearch,
    handleTagListMoreClick,
    handleTagListScroll,
    hasMoreTags,
    search,
    setActiveSearch,
    setSearch,
    setVisibleTags,
    shouldScrollTags,
    showFetchingMoreTags,
    showInitialTagLoading,
    showTagListEnd,
    showTagListMoreIndicator,
    tagListRef,
    visibleTags,
  }
}
