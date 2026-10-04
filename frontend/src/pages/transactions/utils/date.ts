import { getTodayYmd } from '@/utils/date'

export type CurrentMonthOverviewRange = {
  monthStart: string
  today: string
}

/**
 * Returns the current month range in the user's configured timezone for transaction overview metrics
 */
export function getCurrentMonthOverviewRange(
  timeZone: string,
  now = new Date(),
): CurrentMonthOverviewRange {
  const today = getTodayYmd(timeZone, now)
  const monthStart = `${today.slice(0, 7)}-01`
  return { monthStart, today }
}
