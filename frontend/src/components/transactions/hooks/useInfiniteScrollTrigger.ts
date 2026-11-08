import { useCallback, useEffect, useRef, useState } from 'react'

// How far past the edge of the screen the sentinel counts as near
const SENTINEL_OBSERVER_OPTIONS: IntersectionObserverInit = { rootMargin: '200px' }

// How long the sentinel has to stay near before the next page is fetched
const FETCH_DELAY_MS = 1000

/**
 * Watches the sentinel and delays the fetch slightly so the user sees a stable loading state instead
 * of rapid bottom-of-list flicker. Returns the function that stops watching
 *
 * With `rechecksSentinel`, a delay that runs out asks again whether the sentinel is still near, and
 * fetches once the page is next laid out only if it is. On a busy page the delay can run out before
 * the page is laid out again, so the last report may be stale, as when rows growing into the list held
 * the sentinel near for a moment
 */
export function watchSentinel({
  element,
  fetchNextPage,
  setPendingFetch,
  rechecksSentinel,
}: {
  element: HTMLElement
  fetchNextPage: () => void
  setPendingFetch: (pending: boolean) => void
  rechecksSentinel: boolean
}): () => void {
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
          if (!rechecksSentinel) {
            setPendingFetch(false)
            fetchNextPage()
            return
          }
          recheck = new IntersectionObserver((rechecked) => {
            stopWaiting()
            if (rechecked[rechecked.length - 1].isIntersecting) fetchNextPage()
          }, SENTINEL_OBSERVER_OPTIONS)
          recheck.observe(element)
        }, FETCH_DELAY_MS)
      }
    } else if (timeoutId !== null) {
      stopWaiting()
    }
  }, SENTINEL_OBSERVER_OPTIONS)
  observer.observe(element)
  return () => {
    if (timeoutId !== null) stopWaiting()
    observer.disconnect()
  }
}

/**
 * Observes the bottom sentinel and delays infinite-scroll fetches so loading feedback is visible
 */
export function useInfiniteScrollTrigger({
  hasNextPage,
  isFetchingNextPage,
  disabled,
  fetchNextPage,
  rechecksSentinel = false,
}: {
  hasNextPage: boolean | undefined
  isFetchingNextPage: boolean
  disabled: boolean
  fetchNextPage: () => void

  /** Fetches only if the sentinel is still near when the delay runs out, for a list whose rows grow in */
  rechecksSentinel?: boolean
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

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || disabled) return
    if (!sentinelElement) return
    return watchSentinel({
      element: sentinelElement,
      fetchNextPage: () => fetchNextPageRef.current(),
      setPendingFetch,
      rechecksSentinel,
    })
  }, [disabled, hasNextPage, isFetchingNextPage, sentinelElement, rechecksSentinel])

  return {
    sentinelRef,
    showPendingFetch: pendingFetch && hasNextPage && !isFetchingNextPage,
  }
}
