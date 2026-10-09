import { useCallback, useEffect, useRef, useState } from 'react'

// How far past the edge of the screen the sentinel counts as near
const SENTINEL_OBSERVER_OPTIONS: IntersectionObserverInit = { rootMargin: '200px' }

/**
 * Observes the bottom sentinel and delays infinite-scroll fetches so loading feedback is visible
 */
export function useInfiniteScrollTrigger({
  hasNextPage,
  isFetchingNextPage,
  disabled,
  fetchNextPage,
}: {
  hasNextPage: boolean | undefined
  isFetchingNextPage: boolean
  disabled: boolean
  fetchNextPage: () => void
}) {
  const fetchNextPageRef = useRef(fetchNextPage)
  const [sentinelElement, setSentinelElement] = useState<HTMLDivElement | null>(null)
  const [pendingFetch, setPendingFetch] = useState(false)

  useEffect(() => {
    fetchNextPageRef.current = fetchNextPage
  }, [fetchNextPage])

  const sentinelRef = useCallback((element: HTMLDivElement | null) => {
    setSentinelElement(element)
  }, [])

  // Watch the sentinel and delay the fetch slightly so the user sees a stable
  // loading state instead of rapid bottom-of-list flicker. On a busy page the
  // delay can run out before the page is laid out again, so the last report may
  // be stale, as when rows growing into the list held the sentinel near for a
  // moment. Whether it is still near is asked again, and answered once the page
  // is next laid out, before the fetch
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || disabled) return
    const el = sentinelElement
    if (!el) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let recheck: IntersectionObserver | null = null
    const stopWaiting = () => {
      if (timeoutId !== null) clearTimeout(timeoutId)
      timeoutId = null
      recheck?.disconnect()
      recheck = null
      setPendingFetch(false)
    }
    const observer = new IntersectionObserver((entries) => {
      // A busy page can hand over several changes at once, oldest first, so only the last one is current
      if (entries[entries.length - 1].isIntersecting) {
        if (timeoutId === null) {
          setPendingFetch(true)
          timeoutId = setTimeout(() => {
            recheck = new IntersectionObserver(([entry]) => {
              stopWaiting()
              if (entry.isIntersecting) fetchNextPageRef.current()
            }, SENTINEL_OBSERVER_OPTIONS)
            recheck.observe(el)
          }, 1000)
        }
      } else if (timeoutId !== null) {
        stopWaiting()
      }
    }, SENTINEL_OBSERVER_OPTIONS)
    observer.observe(el)
    return () => {
      if (timeoutId !== null) stopWaiting()
      observer.disconnect()
    }
  }, [disabled, hasNextPage, isFetchingNextPage, sentinelElement])

  return {
    sentinelRef,
    showPendingFetch: pendingFetch && hasNextPage && !isFetchingNextPage,
  }
}
