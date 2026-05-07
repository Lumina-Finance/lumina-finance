import { useEffect, useRef, useState } from 'react'

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
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [pendingFetch, setPendingFetch] = useState(false)

  // Watch the sentinel and delay the fetch slightly so the user sees a stable
  // loading state instead of rapid bottom-of-list flicker.
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || disabled) return
    const el = sentinelRef.current
    if (!el) return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        if (timeoutId === null) {
          setPendingFetch(true)
          timeoutId = setTimeout(() => {
            setPendingFetch(false)
            fetchNextPage()
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
      if (timeoutId !== null) clearTimeout(timeoutId)
      observer.disconnect()
    }
  }, [disabled, fetchNextPage, hasNextPage, isFetchingNextPage])

  return {
    sentinelRef,
    showPendingFetch: pendingFetch && hasNextPage && !isFetchingNextPage,
  }
}
