import { useEffect, useRef, useState } from 'react'
import {
  ACCOUNT_SKELETON_DELAY_MS,
  ACCOUNT_SKELETON_MINIMUM_MS,
} from '@/pages/accounts/detail/constants/accountDetail'

/**
 * Reports whether the loading skeleton should be on screen, holding it back on a fast load and
 * holding it up on a load that finishes just after it appeared
 *
 * The skeleton is shown once the delay has elapsed, and stays for as long as the request is still
 * running or the minimum has not expired, whichever ends later. A request that finishes inside the
 * delay never shows one at all
 *
 * @param isLoading - Whether the thing the skeleton stands in for is still on its way
 */
export function useSkeletonVisibility(isLoading: boolean): boolean {
  const [visible, setVisible] = useState(false)

  // When the skeleton appeared, so the minimum can be measured from it. Null while nothing is shown
  const shownAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (isLoading) {
      if (shownAtRef.current !== null) return

      const appearTimer = setTimeout(() => {
        shownAtRef.current = Date.now()
        setVisible(true)
      }, ACCOUNT_SKELETON_DELAY_MS)

      // Clears the timer when the request finishes inside the delay, so the skeleton never appears
      // over a page that has already painted
      return () => clearTimeout(appearTimer)
    }

    if (shownAtRef.current === null) return

    const remaining = ACCOUNT_SKELETON_MINIMUM_MS - (Date.now() - shownAtRef.current)
    if (remaining <= 0) {
      shownAtRef.current = null
      setVisible(false)
      return
    }

    const hideTimer = setTimeout(() => {
      shownAtRef.current = null
      setVisible(false)
    }, remaining)

    return () => clearTimeout(hideTimer)
  }, [isLoading])

  return visible
}
