import { useEffect, useRef } from 'react'
import { fetchAppVersion } from '@/api/version'
// The same pace as a signed-in page asking whether its data changed during a maintenance
import { CACHE_STATUS_RETRY_INTERVAL_MS as MAINTENANCE_RECHECK_INTERVAL_MS } from '@/hooks/useCacheValidation'

/**
 * Asks the server again once a minute during a maintenance, for a page with nothing else asking
 *
 * Any answer the app makes ends the maintenance, so a signed-out form gets its buttons back by
 * itself once the server is up. A failed ask changes nothing and the next one follows a minute later.
 * When the maintenance ends, onEnd runs, for the page to load again what failed during it
 */
export function useMaintenanceRecheck(inMaintenance: boolean, onEnd: () => void) {
  const wasInMaintenance = useRef(inMaintenance)
  const latestOnEnd = useRef(onEnd)

  useEffect(() => {
    latestOnEnd.current = onEnd
  })

  useEffect(() => {
    if (wasInMaintenance.current && !inMaintenance) latestOnEnd.current()
    wasInMaintenance.current = inMaintenance
    if (!inMaintenance) return

    const timer = window.setInterval(() => {
      void fetchAppVersion().catch(() => undefined)
    }, MAINTENANCE_RECHECK_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [inMaintenance])
}
