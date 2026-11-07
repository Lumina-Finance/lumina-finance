import { useEffect, useState } from 'react'

/**
 * Returns whether newly mounted rows should appear without growing in. That holds for the rows of a
 * page that just finished loading
 *
 * A finished page load appends a whole batch of rows at once. That looks chaotic if each grows in.
 * Arming this the moment a page fetch starts means it is still set when that page's rows mount, so
 * they appear without animating. Arming happens during render so it is in place before the rows
 * commit, and it disarms once they have mounted, so a later single row still animates
 */
export function useSkipAppendedEnter(isFetchingNextPage: boolean): boolean {
  const [skipAppendedEnter, setSkipAppendedEnter] = useState(false)
  const [wasFetchingNextPage, setWasFetchingNextPage] = useState(isFetchingNextPage)
  if (wasFetchingNextPage !== isFetchingNextPage) {
    setWasFetchingNextPage(isFetchingNextPage)
    if (isFetchingNextPage) setSkipAppendedEnter(true)
  }

  useEffect(() => {
    if (isFetchingNextPage || !skipAppendedEnter) return
    const timer = window.setTimeout(() => setSkipAppendedEnter(false), 0)
    return () => window.clearTimeout(timer)
  }, [isFetchingNextPage, skipAppendedEnter])

  return skipAppendedEnter
}
