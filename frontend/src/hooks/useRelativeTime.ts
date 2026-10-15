import { useEffect, useState } from 'react'
import { formatRelativeTime } from '@/utils/relativeTime'

// How often the words are worked out again. Their smallest step is a minute, so checking each minute
// moves them within a minute of the time that changes them, through sleep included
const RELATIVE_TIME_CHECK_INTERVAL_MS = 60 * 1000

/**
 * Words a past ISO-8601 timestamp relative to now, such as "5 minutes ago", and keeps them matching
 * the clock while the caller stays on screen. Returns null for a null timestamp
 *
 * Re-renders the caller only when the words actually change
 */
export function useRelativeTime(iso: string | null): string | null {
  const words = iso === null ? null : formatRelativeTime(iso)

  // Holds the words last checked only to compare them, since the words themselves are worked out above
  const [, setCheckedWords] = useState(words)
  useEffect(() => {
    if (iso === null) return
    const intervalId = setInterval(() => setCheckedWords(formatRelativeTime(iso)), RELATIVE_TIME_CHECK_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [iso])

  return words
}
