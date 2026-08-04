import type { BaseBudget, Budget, RecurrenceFreq } from '@/api/budgets'
import type { BudgetFormState, CalendarDate } from '@/pages/budgets/types'
import { addDays, addMonths, anchorDay, formatCalendarDate, parseCalendarDate } from '@/pages/budgets/utils/date'

/**
 * Converts a period start date into the backend recurrence anchor fields
 */
export function recurrenceAnchorsFromStart(freq: RecurrenceFreq, periodStart: string) {
  const parsed = parseCalendarDate(periodStart)
  // A period start comes from a date column or a field that clamps to a real day, so this guards the
  // type rather than a case seen in practice. The backend refuses an unreadable period_start
  // whatever anchors accompany it, so leaving them unset adds no second failure
  if (!parsed) return { recurrence_weekday: null, recurrence_dom: null, recurrence_month: null }

  const { year, month, day } = parsed
  const start = new Date(year, month - 1, day)

  // Backend stores Monday as 0 for weekly recurrence anchors
  const weekday = (start.getDay() + 6) % 7

  if (freq === 'weekly') {
    return { recurrence_weekday: weekday, recurrence_dom: null, recurrence_month: null }
  }

  if (freq === 'monthly') {
    return { recurrence_weekday: null, recurrence_dom: day, recurrence_month: null }
  }

  return { recurrence_weekday: null, recurrence_dom: day, recurrence_month: month }
}

/**
 * Derives the inclusive end date for one-off budgets from the selected cadence, or null when the
 * start is not a real date
 */
export function oneOffPeriodEnd(form: BudgetFormState): CalendarDate | null {
  const start = parseCalendarDate(form.periodStart)
  if (!start) return null

  if (form.recurrenceFreq === 'weekly') {
    return addDays(start, 6)
  }

  if (form.recurrenceFreq === 'monthly') {
    return addDays(addMonths(start, 1), -1)
  }

  return addDays({ year: start.year + 1, month: start.month, day: anchorDay(start.year + 1, start.month, start.day) }, -1)
}

/**
 * Builds the live cadence sentence shown while users edit budget period settings
 */
export function cadenceSummary(form: BudgetFormState) {
  const length = Number(form.instanceLength)
  const safeLength = Number.isFinite(length) && length > 0 ? length : 1
  const name = form.name.trim() || 'Untitled'

  const start = parseCalendarDate(form.periodStart)

  if (!form.recurs) {
    if (!form.periodStart) return `"${name}" is one-off`

    const end = oneOffPeriodEnd(form)
    if (!start || !end) return `"${name}" is one-off starting ${form.periodStart}`

    return `"${name}" is one-off starting ${formatCalendarDate(start)} and ending ${formatCalendarDate(end)}`
  }

  let cadence: string
  if (form.recurrenceFreq === 'weekly') {
    cadence = safeLength === 1 ? 'weekly' : `every ${safeLength} weeks`
  } else if (form.recurrenceFreq === 'monthly') {
    cadence = safeLength === 1 ? 'monthly' : `every ${safeLength} months`
  } else {
    cadence = safeLength === 1 ? 'yearly' : `every ${safeLength} years`
  }

  const startLabel = start ? formatCalendarDate(start) : (form.periodStart || 'the selected start date')

  return `"${name}" will repeat ${cadence} starting ${startLabel}`
}

/**
 * Formats the recurrence cadence used in budget cards and details metadata
 */
export function budgetCadenceLabel(baseBudget: BaseBudget) {
  if (!baseBudget.recurs) return 'One-off'
  if (baseBudget.instance_length === 1) {
    return baseBudget.recurrence_freq[0].toUpperCase() + baseBudget.recurrence_freq.slice(1)
  }
  return `Every ${baseBudget.instance_length} ${baseBudget.recurrence_freq === 'yearly' ? 'years' : `${baseBudget.recurrence_freq.slice(0, -2)}s`}`
}

/**
 * Formats a budget period range for compact card and modal labels
 */
export function formatBudgetPeriod(period: Budget | undefined) {
  if (!period) return 'No period yet'
  return `${formatPeriodBound(period.period_start)} - ${formatPeriodBound(period.period_end)}`
}

/**
 * Formats one end of a stored period, falling back to the value itself when it is not a real date
 */
function formatPeriodBound(ymd: string) {
  const parsed = parseCalendarDate(ymd)
  return parsed ? formatCalendarDate(parsed) : ymd
}

/**
 * Converts monthly and yearly recurrence intervals into whole months
 */
function periodLengthInMonths(baseBudget: BaseBudget) {
  if (baseBudget.recurrence_freq === 'monthly') return baseBudget.instance_length
  if (baseBudget.recurrence_freq === 'yearly') return baseBudget.instance_length * 12
  return 0
}

/**
 * Advances a period start by one configured recurrence interval
 */
function addBudgetPeriod(start: CalendarDate, baseBudget: BaseBudget) {
  if (baseBudget.recurrence_freq === 'weekly') {
    return addDays(start, baseBudget.instance_length * 7)
  }

  // The backend re-anchors every period to recurrence_dom capped to the target month, so a dom-31 series
  // re-expands after a short month (Feb28 -> Mar31) instead of sticking at the clamped day addMonths returned
  const advanced = addMonths(start, periodLengthInMonths(baseBudget))
  const anchorDom = baseBudget.recurrence_dom ?? start.day
  return { ...advanced, day: anchorDay(advanced.year, advanced.month, anchorDom) }
}

/**
 * Orders plain calendar dates without converting them through browser timezone rules
 */
function compareCalendarDates(a: CalendarDate, b: CalendarDate) {
  if (a.year !== b.year) return a.year - b.year
  if (a.month !== b.month) return a.month - b.month
  return a.day - b.day
}

/**
 * Formats a plain calendar date as the backend budget period key
 */
function formatYmd(date: CalendarDate) {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${date.year}-${month}-${day}`
}

/**
 * Formats the inclusive period range that starts at the supplied calendar date
 */
function formatPeriodRange(start: CalendarDate, baseBudget: BaseBudget) {
  const nextStart = addBudgetPeriod(start, baseBudget)
  return `${formatCalendarDate(start)} - ${formatCalendarDate(addDays(nextStart, -1))}`
}

/**
 * Returns the period start that immediately follows the supplied start after one recurrence cycle,
 * or null when the supplied start is not a real date
 */
export function nextRecurringPeriodStart(baseBudget: BaseBudget, periodStart: string) {
  const start = parseCalendarDate(periodStart)
  if (!start) return null

  return formatYmd(addBudgetPeriod(start, baseBudget))
}

/**
 * Returns the next two recurrence ranges shown on budget cards
 */
export function nextBudgetPeriods(baseBudget: BaseBudget, latestPeriod: Budget | undefined) {
  // Archived budgets stop generating periods, so there is nothing upcoming to preview
  if (!baseBudget.recurs || !latestPeriod || baseBudget.is_archived) return []

  // A stored start that is not a real date previews nothing, rather than previewing dates stepped
  // from a day the calendar rolled forward
  const latestStart = parseCalendarDate(latestPeriod.period_start)
  if (!latestStart) return []

  const nextStart = addBudgetPeriod(latestStart, baseBudget)
  const followingStart = addBudgetPeriod(nextStart, baseBudget)

  return [
    formatPeriodRange(nextStart, baseBudget),
    formatPeriodRange(followingStart, baseBudget),
  ]
}

/**
 * Lists recurring period starts that should have existed by the supplied local day
 */
export function missingRecurringPeriodStarts(baseBudget: BaseBudget, latestPeriod: Budget | undefined, today: string) {
  if (!baseBudget.recurs || !latestPeriod) return []

  const todayDate = parseCalendarDate(today)
  const latestStart = parseCalendarDate(latestPeriod.period_start)

  // Creating periods from a start that is not a real date would write the rolled-forward day to the
  // backend, so nothing is created until the stored value is fixed
  if (!todayDate || !latestStart) return []

  const starts: string[] = []
  let nextStart = addBudgetPeriod(latestStart, baseBudget)

  // Create every elapsed start so stale budgets catch up after multiple missed cycles
  while (compareCalendarDates(nextStart, todayDate) <= 0) {
    starts.push(formatYmd(nextStart))
    nextStart = addBudgetPeriod(nextStart, baseBudget)
  }

  return starts
}
