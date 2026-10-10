import { useEffect, useRef, useState } from 'react'

// How often words telling a time relative to now are worked out again. They count in minutes at the
// finest, such as "5 minutes ago" or "in 2 hours", so checking each minute keeps them current
const RELATIVE_TIME_CHECK_INTERVAL_MS = 60 * 1000

/**
 * Keeps words that tell a time relative to now, such as "Synced 5 minutes ago" or "frees up in 2
 * hours", current while the caller shows them, since nothing else re-renders it while the data they
 * come from stays as it was read
 *
 * The words are worked out again each minute, re-rendering the caller only when they change
 *
 * @param describe - Works out, from now, the words the caller shows
 */
export function useRelativeTimeRefresh(describe: () => string): void {
  const describeRef = useRef(describe)
  // Holds the words last checked only to compare them, since the caller works out the words it shows
  const [, setCheckedWording] = useState(describe)

  useEffect(() => {
    describeRef.current = describe
  }, [describe])

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCheckedWording(describeRef.current())
    }, RELATIVE_TIME_CHECK_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [])
}
