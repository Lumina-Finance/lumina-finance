
import type { BaseBudget, Budget, RecurrenceFreq } from '@/api/budgets'
import type { BudgetFormState, CalendarDate } from '@/budgets/types'
import { addDays, addMonths, anchorDay, formatCalendarDate, parseYmd } from '@/budgets/utils/date'

export function recurrenceAnchorsFromStart(freq: RecurrenceFreq, periodStart: string) {
  const { year, month, day } = parseYmd(periodStart)
  const start = new Date(year, month - 1, day)
  // Backend stores Monday as 0 for weekly recurrence anchors.
  const weekday = (start.getDay() + 6) % 7

  if (freq === 'weekly') {
    return { recurrence_weekday: weekday, recurrence_dom: null, recurrence_month: null }
  }

  if (freq === 'monthly') {
    return { recurrence_weekday: null, recurrence_dom: day, recurrence_month: null }
  }

  return { recurrence_weekday: null, recurrence_dom: day, recurrence_month: month }
}

export function oneOffPeriodEnd(form: BudgetFormState): CalendarDate {
  const start = parseYmd(form.periodStart)

  if (form.recurrenceFreq === 'weekly') {
    return addDays(start, 6)
  }

  if (form.recurrenceFreq === 'monthly') {
    return addDays(addMonths(start, 1), -1)
  }

  return addDays({ year: start.year + 1, month: start.month, day: anchorDay(start.year + 1, start.month, start.day) }, -1)
}

export function cadenceSummary(form: BudgetFormState) {
  const length = Number(form.instanceLength)
  const safeLength = Number.isFinite(length) && length > 0 ? length : 1
  const name = form.name.trim() || 'Untitled'

  if (!form.recurs) {
    if (!form.periodStart) return `"${name}" is one-off`
    return `"${name}" is one-off starting ${formatCalendarDate(parseYmd(form.periodStart))} and ending ${formatCalendarDate(oneOffPeriodEnd(form))}`
  }

  let cadence: string
  if (form.recurrenceFreq === 'weekly') {
    cadence = safeLength === 1 ? 'weekly' : `every ${safeLength} weeks`
  } else if (form.recurrenceFreq === 'monthly') {
    cadence = safeLength === 1 ? 'monthly' : `every ${safeLength} months`
  } else {
    cadence = safeLength === 1 ? 'yearly' : `every ${safeLength} years`
  }

  return `"${name}" will repeat ${cadence} starting ${form.periodStart ? formatCalendarDate(parseYmd(form.periodStart)) : 'the selected start date'}`
}

export function budgetCadenceLabel(baseBudget: BaseBudget) {
  if (!baseBudget.recurs) return 'One-off'
  if (baseBudget.instance_length === 1) {
    return baseBudget.recurrence_freq[0].toUpperCase() + baseBudget.recurrence_freq.slice(1)
  }
  return `Every ${baseBudget.instance_length} ${baseBudget.recurrence_freq === 'yearly' ? 'years' : `${baseBudget.recurrence_freq.slice(0, -2)}s`}`
}

export function formatBudgetPeriod(period: Budget | undefined) {
  if (!period) return 'No period yet'
  return `${formatCalendarDate(parseYmd(period.period_start))} - ${formatCalendarDate(parseYmd(period.period_end))}`
}

function periodLengthInMonths(baseBudget: BaseBudget) {
  if (baseBudget.recurrence_freq === 'monthly') return baseBudget.instance_length
  if (baseBudget.recurrence_freq === 'yearly') return baseBudget.instance_length * 12
  return 0
}

function addBudgetPeriod(start: CalendarDate, baseBudget: BaseBudget) {
  if (baseBudget.recurrence_freq === 'weekly') {
    return addDays(start, baseBudget.instance_length * 7)
  }

  return addMonths(start, periodLengthInMonths(baseBudget))
}

function compareCalendarDates(a: CalendarDate, b: CalendarDate) {
  if (a.year !== b.year) return a.year - b.year
  if (a.month !== b.month) return a.month - b.month
  return a.day - b.day
}

function formatYmd(date: CalendarDate) {
  const month = String(date.month).padStart(2, '0')
  const day = String(date.day).padStart(2, '0')
  return `${date.year}-${month}-${day}`
}

function formatPeriodRange(start: CalendarDate, baseBudget: BaseBudget) {
  const nextStart = addBudgetPeriod(start, baseBudget)
  return `${formatCalendarDate(start)} - ${formatCalendarDate(addDays(nextStart, -1))}`
}

export function nextBudgetPeriods(baseBudget: BaseBudget, latestPeriod: Budget | undefined) {
  if (!baseBudget.recurs || !latestPeriod) return []

  const nextStart = addBudgetPeriod(parseYmd(latestPeriod.period_start), baseBudget)
  const followingStart = addBudgetPeriod(nextStart, baseBudget)

  return [
    formatPeriodRange(nextStart, baseBudget),
    formatPeriodRange(followingStart, baseBudget),
  ]
}

export function missingRecurringPeriodStarts(baseBudget: BaseBudget, latestPeriod: Budget | undefined, today: string) {
  if (!baseBudget.recurs || !latestPeriod) return []

  const todayDate = parseYmd(today)
  const starts: string[] = []
  let nextStart = addBudgetPeriod(parseYmd(latestPeriod.period_start), baseBudget)

  // Create all elapsed period starts, not only the next one, so a stale budget
  // catches up after the user has been away for multiple cycles.
  while (compareCalendarDates(nextStart, todayDate) <= 0) {
    starts.push(formatYmd(nextStart))
    nextStart = addBudgetPeriod(nextStart, baseBudget)
  }

  return starts
}
