import { useEffect, useState } from 'react'
import type { LastImport } from '@/api/import-runs'

/**
 * Returns the import while it can still be undone, and null once its undo window has closed
 *
 * Checked against the time the page opened, so an expired import kept in the saved cache never
 * shows while it is read again, and against the time again when the window closes and whenever the
 * page is shown again, since a timer can stall while the computer sleeps
 */
export function useUndoableEntry(entry: LastImport | null) {
  const [checkedAt, setCheckedAt] = useState(() => Date.now())

  useEffect(() => {
    if (!entry) return
    const recheck = () => setCheckedAt(Date.now())
    // A millisecond past the close, since a browser may fire a timer slightly early
    const timer = window.setTimeout(recheck, new Date(entry.undo_until).getTime() - Date.now() + 1)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [entry])

  return entry && new Date(entry.undo_until).getTime() > checkedAt ? entry : null
}
