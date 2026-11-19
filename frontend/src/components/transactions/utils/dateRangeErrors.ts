import { getDateWindowError, getOverviewRangeSpanError } from '@/utils/dateWindow'

export type DateRangeErrors = {
  from: string | null
  to: string | null
}

/**
 * Returns the message each date field of a filter draft shows, or null for a field that is fine
 *
 * A date outside the window every date must sit in is refused on its own field. When the list sits
 * below a summary, the summary asks for both ends, so a range leading the summary to cover over 20
 * years is refused too: on To when To is set, otherwise on From. Without a To, the summary counts up
 * to today
 *
 * @param range - The draft's dates as "YYYY-MM-DD", "" for one not set
 * @param todayYmd - Today in the user's timezone as "YYYY-MM-DD"
 * @param checksSummarySpan - Whether a summary sits above the list this filter belongs to
 */
export function getDateRangeErrors(
  range: { from: string; to: string },
  todayYmd: string,
  checksSummarySpan: boolean,
): DateRangeErrors {
  const spanError = checksSummarySpan ? getOverviewRangeSpanError(range.from, range.to, todayYmd) : null
  return {
    from:
      getDateWindowError(range.from, todayYmd) ?? (range.to === '' && spanError ? `${spanError} up to today` : null),
    to: getDateWindowError(range.to, todayYmd) ?? (range.to === '' ? null : spanError),
  }
}
