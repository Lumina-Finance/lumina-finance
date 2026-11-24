/**
 * Tests budget period helpers so recurrence anchors, card previews, and automatic backfill stay aligned with backend period rules
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { BaseBudget, Budget, RecurrenceFreq } from '@/api/budgets'
import type { BudgetFormState } from '@/pages/budgets/types'
import {
  budgetCadenceLabel,
  cadenceSummary,
  missingRecurringPeriodStarts,
  nextBudgetPeriods,
  nextRecurringPeriodStart,
  oneOffPeriodEnd,
  recurrenceAnchorsFromStart,
} from '@/pages/budgets/utils/budgetPeriods'
import { formatYmd } from '@/utils/date'
import {
  calendarDays,
  getDaysInUtcMonth,
  lateMonthDays,
  leapDays,
  shiftCalendarDays,
  toYmd,
  type CalendarDay,
} from '@tests/utils/generators'

/**
 * Creates a recurring monthly base budget fixture
 */
function createBaseBudget(overrides: Partial<BaseBudget> = {}): BaseBudget {
  return {
    id: overrides.id ?? 'base-budget',
    owner_id: null,
    group_id: null,
    name: overrides.name ?? 'Groceries',
    currency: 'CAD',
    recurrence_freq: 'monthly',
    instance_length: 1,
    recurrence_weekday: null,
    recurrence_dom: 1,
    recurrence_month: null,
    recurs: true,
    created_at: '2026-01-01T00:00:00Z',
    is_archived: false,
    category_ids: ['groceries'],
    ...overrides,
  }
}

/**
 * Creates a budget period fixture tied to the supplied base budget
 */
function createBudget(baseBudget: BaseBudget, overrides: Partial<Budget> = {}): Budget {
  return {
    id: overrides.id ?? 'budget-period',
    base_budget_id: baseBudget.id,
    period_start: overrides.period_start ?? '2026-06-01',
    period_end: overrides.period_end ?? '2026-06-30',
    overall_limit: overrides.overall_limit ?? 100000,
    created_at: '2026-06-01T00:00:00Z',
    base_budget: baseBudget,
    ...overrides,
  }
}

/**
 * Creates a budget form fixture with valid recurring monthly defaults
 */
function createForm(overrides: Partial<BudgetFormState> = {}): BudgetFormState {
  return {
    name: 'Groceries',
    currency: 'CAD',
    categoryIds: ['groceries'],
    limit: '1,000.00',
    recurrenceFreq: 'monthly',
    instanceLength: '1',
    periodStart: '2026-06-01',
    recurs: true,
    ...overrides,
  }
}

/**
 * Returns a series' start in a month: its anchor day, or the month's last day when the month is
 * shorter. A month past December falls in a later year
 */
function getAnchorDay(year: number, month: number, dom: number): CalendarDay {
  const monthCount = year * 12 + month - 1
  const anchorYear = Math.floor(monthCount / 12)
  const anchorMonth = (monthCount % 12) + 1

  return { year: anchorYear, month: anchorMonth, day: Math.min(dom, getDaysInUtcMonth(anchorYear, anchorMonth)) }
}

/**
 * Returns how a series steps from one start to the next, written out as the backend's period end and
 * start check have it, so a start this gives is one the backend accepts
 */
function getNextStartRule(freq: RecurrenceFreq, length: number, dom: number, month: number) {
  return (start: CalendarDay): CalendarDay => {
    if (freq === 'weekly') return shiftCalendarDays(start, 7 * length)
    if (freq === 'monthly') return getAnchorDay(start.year, start.month + length, dom)
    return getAnchorDay(start.year + length, month, dom)
  }
}

// Days a month-stepping rule treats differently: any day, the last days of a month and 29 February
const startDays = fc.oneof(calendarDays, lateMonthDays, leapDays)

/**
 * Draws a recurring base budget with its latest start, landed on its anchor
 */
const recurringSeries = fc
  .record({
    freq: fc.constantFrom<RecurrenceFreq>('weekly', 'monthly', 'yearly'),
    firstDay: startDays,
    // Any anchor day, with the days a short month clamps drawn half the time
    dom: fc.oneof(fc.integer({ min: 1, max: 31 }), fc.integer({ min: 28, max: 31 })),
    length: fc.integer({ min: 1, max: 36 }),
  })
  .map(({ freq, firstDay, dom, length }) => {
    const isWeekly = freq === 'weekly'
    const latestStart = isWeekly ? firstDay : getAnchorDay(firstDay.year, firstDay.month, dom)
    const baseBudget = createBaseBudget({
      recurrence_freq: freq,
      instance_length: length,
      // Monday counts as 0, as the backend stores it
      recurrence_weekday: isWeekly
        ? (new Date(Date.UTC(firstDay.year, firstDay.month - 1, firstDay.day)).getUTCDay() + 6) % 7
        : null,
      recurrence_dom: isWeekly ? null : dom,
      recurrence_month: freq === 'yearly' ? firstDay.month : null,
    })

    return { baseBudget, latestStart, nextStart: getNextStartRule(freq, length, dom, firstDay.month) }
  })

/**
 * Draws a series with the day the backfill runs: any day from a month before its latest start to
 * past several periods, or the day a start falls due, or the day before or after it, since the
 * backfill's cut-off turns on a start due today
 */
const seriesWithToday = recurringSeries.chain((series) => {
  const anyDay = fc
    .integer({ min: -31, max: 4000 })
    .map((offsetDays) => shiftCalendarDays(series.latestStart, offsetDays))
  const nearDueStart = fc
    .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: -1, max: 1 }))
    .map(([periods, nudgeDays]) => {
      let start = series.latestStart
      for (let index = 0; index < periods; index += 1) start = series.nextStart(start)

      return shiftCalendarDays(start, nudgeDays)
    })

  return fc.oneof(anyDay, nearDueStart).map((today) => ({ ...series, today: toYmd(today) }))
})

describe('budget period helpers', () => {
  it('converts period starts into backend recurrence anchors', () => {
    expect(recurrenceAnchorsFromStart('weekly', '2026-06-15')).toEqual({
      recurrence_weekday: 0,
      recurrence_dom: null,
      recurrence_month: null,
    })
    expect(recurrenceAnchorsFromStart('monthly', '2026-06-15')).toEqual({
      recurrence_weekday: null,
      recurrence_dom: 15,
      recurrence_month: null,
    })
    expect(recurrenceAnchorsFromStart('yearly', '2026-06-15')).toEqual({
      recurrence_weekday: null,
      recurrence_dom: 15,
      recurrence_month: 6,
    })
  })

  it('anchors a weekly budget starting on a Sunday to the last day of the week', () => {
    expect(recurrenceAnchorsFromStart('weekly', '2026-06-21')).toEqual({
      recurrence_weekday: 6,
      recurrence_dom: null,
      recurrence_month: null,
    })
  })

  it('summarizes one-off and recurring form cadence', () => {
    expect(cadenceSummary(createForm({ name: '  ', recurs: false }))).toBe(
      '"Untitled" is one-off starting Jun 1, 2026 and ending Jun 30, 2026',
    )
    expect(cadenceSummary(createForm({ recurrenceFreq: 'weekly', instanceLength: '2' }))).toBe(
      '"Groceries" will repeat every 2 weeks starting Jun 1, 2026',
    )
  })

  it('formats cadence labels and next budget period previews', () => {
    const baseBudget = createBaseBudget()
    const latestPeriod = createBudget(baseBudget)

    expect(budgetCadenceLabel(baseBudget)).toBe('Monthly')
    expect(nextBudgetPeriods(baseBudget, latestPeriod)).toEqual(['Jul 1 – 31, 2026', 'Aug 1 – 31, 2026'])
  })

  it('returns no upcoming periods for an archived recurring budget', () => {
    const baseBudget = createBaseBudget({ is_archived: true })
    const latestPeriod = createBudget(baseBudget)

    expect(nextBudgetPeriods(baseBudget, latestPeriod)).toEqual([])
  })

  it('returns no upcoming periods for a read-only recurring budget', () => {
    const baseBudget = createBaseBudget({ read_only_reason: 'Records in USD are read-only' })
    const latestPeriod = createBudget(baseBudget)

    expect(nextBudgetPeriods(baseBudget, latestPeriod)).toEqual([])
  })

  it('lists a monthly series anchored on the 31st through February and stops before a start after today', () => {
    const baseBudget = createBaseBudget({ recurrence_dom: 31 })
    const latestPeriod = createBudget(baseBudget, { period_start: '2025-12-31' })

    expect(missingRecurringPeriodStarts(baseBudget, latestPeriod, '2026-03-30')).toEqual(['2026-01-31', '2026-02-28'])
  })

  it('lists missing starts one cadence apart in strictly increasing order, none after today and none left out', () => {
    fc.assert(
      fc.property(seriesWithToday, (series) => {
        const { today } = series
        const latestPeriod = createBudget(series.baseBudget, { period_start: toYmd(series.latestStart) })

        const starts = missingRecurringPeriodStarts(series.baseBudget, latestPeriod, today)

        let previous = toYmd(series.latestStart)
        let expected = series.nextStart(series.latestStart)
        for (const start of starts) {
          expect(start > previous, `${start} follows ${previous}`).toBe(true)
          expect(start <= today, `${start} is not after ${today}`).toBe(true)
          expect(start).toBe(toYmd(expected))
          expect(nextRecurringPeriodStart(series.baseBudget, previous)).toBe(start)
          previous = start
          expected = series.nextStart(expected)
        }
        expect(toYmd(expected) > today, `the next start ${toYmd(expected)} is after ${today}`).toBe(true)
      }),
    )
  })

  it('ends a one-off period the day before the start one cadence later, as the backend does', () => {
    fc.assert(
      fc.property(startDays, fc.constantFrom<RecurrenceFreq>('weekly', 'monthly', 'yearly'), (start, freq) => {
        const form = createForm({ recurs: false, recurrenceFreq: freq, periodStart: toYmd(start) })
        // A one-off period is sent with anchors taken from its own start
        const nextStart = getNextStartRule(freq, 1, start.day, start.month)(start)

        const end = oneOffPeriodEnd(form)

        expect(end && formatYmd(end)).toBe(toYmd(shiftCalendarDays(nextStart, -1)))
      }),
    )
  })

  it('backfills nothing from a stored start the calendar does not have', () => {
    const baseBudget = createBaseBudget()
    const latestPeriod = createBudget(baseBudget, { period_start: '2026-02-31' })

    expect(missingRecurringPeriodStarts(baseBudget, latestPeriod, '2026-08-15')).toEqual([])
  })

  it('previews nothing from a stored start the calendar does not have', () => {
    const baseBudget = createBaseBudget()
    const latestPeriod = createBudget(baseBudget, { period_start: '2026-02-31' })

    expect(nextBudgetPeriods(baseBudget, latestPeriod)).toEqual([])
    expect(nextRecurringPeriodStart(baseBudget, '2026-02-31')).toBeNull()
  })

  it('keeps a period start the calendar does not have as its own label', () => {
    expect(cadenceSummary(createForm({ recurs: false, periodStart: '2026-02-31' }))).toBe(
      '"Groceries" is one-off starting 2026-02-31',
    )
    expect(cadenceSummary(createForm({ periodStart: '2026-02-31' }))).toBe(
      '"Groceries" will repeat monthly starting 2026-02-31',
    )
    expect(oneOffPeriodEnd(createForm({ recurs: false, periodStart: '2026-02-31' }))).toBeNull()
  })

  it('re-anchors to recurrence_dom across short months for a dom-31 monthly budget', () => {
    const baseBudget = createBaseBudget({ recurrence_dom: 31 })

    expect(nextRecurringPeriodStart(baseBudget, '2026-01-31')).toBe('2026-02-28')
    expect(nextRecurringPeriodStart(baseBudget, '2026-02-28')).toBe('2026-03-31')
    expect(nextRecurringPeriodStart(baseBudget, '2026-04-30')).toBe('2026-05-31')
  })

  it('ends a one-off yearly budget from a leap day the day before its clamped anniversary', () => {
    const form = createForm({ recurs: false, recurrenceFreq: 'yearly', periodStart: '2028-02-29' })

    expect(oneOffPeriodEnd(form)).toEqual(new Date(2029, 1, 27))
  })

  it('re-anchors to recurrence_dom for a dom-29 monthly budget across a leap year', () => {
    const baseBudget = createBaseBudget({ recurrence_dom: 29 })

    expect(nextRecurringPeriodStart(baseBudget, '2024-01-29')).toBe('2024-02-29')
    expect(nextRecurringPeriodStart(baseBudget, '2024-02-29')).toBe('2024-03-29')
  })
})
