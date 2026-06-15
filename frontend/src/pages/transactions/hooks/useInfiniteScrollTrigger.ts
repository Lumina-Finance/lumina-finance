import { useCallback, useEffect, useRef, useState } from 'react'

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
  // loading state instead of rapid bottom-of-list flicker
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || disabled) return
    const el = sentinelElement
    if (!el) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (timeoutId === null) {
          setPendingFetch(true)
          timeoutId = setTimeout(() => {
            setPendingFetch(false)
            fetchNextPageRef.current()
          }, 1000)
        }
      } else if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
        setPendingFetch(false)
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        setPendingFetch(false)
      }
      observer.disconnect()
    }
  }, [disabled, hasNextPage, isFetchingNextPage, sentinelElement])

  return {
    sentinelRef,
    showPendingFetch: pendingFetch && hasNextPage && !isFetchingNextPage,
  }
}
