import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { getTodayYmd, resolveTimeZone } from '@/utils/date'

// How often the day is read again. Checking every minute moves what depends on the date within a minute
// of midnight, and keeps working through sleep and daylight saving changes, which a single timer set
// for midnight would miss
const TODAY_CHECK_INTERVAL_MS = 60 * 1000

/**
 * Returns today as "YYYY-MM-DD" in the signed-in user's profile timezone, updating when the day turns over
 *
 * Re-renders the caller only when the day actually changes, or when the profile's timezone does
 */
export function useTodayYmd(): string {
  const { user } = useAuth()
  const timeZone = resolveTimeZone(user?.tz)
  const [checked, setChecked] = useState(() => ({ timeZone, today: getTodayYmd(timeZone) }))

  useEffect(() => {
    const intervalId = setInterval(() => {
      const today = getTodayYmd(timeZone)
      setChecked((previous) =>
        previous.timeZone === timeZone && previous.today === today ? previous : { timeZone, today },
      )
    }, TODAY_CHECK_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [timeZone])

  // A timezone changed since the last check is read straight away rather than a minute later
  return checked.timeZone === timeZone ? checked.today : getTodayYmd(timeZone)
}
