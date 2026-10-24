/**
 * Covers the savings-rate trend card's header stats, so the average of the completed months rounds
 * down like every other savings rate shown beside it, and the month its tooltip names, which is none
 * when no bar is active
 */
import { describe, expect, it } from 'vitest'
import type { SavingsRateHistoryPoint } from '@/pages/insights/types/savingsRate'
import { getSavingsRateSummary, getSavingsRateTooltipPoint } from '@/pages/insights/utils/savingsRateChart'

function point(monthKey: string, rate: number | null, isCurrent = false): SavingsRateHistoryPoint {
  return {
    monthKey,
    monthLabel: monthKey,
    tickLabel: monthKey,
    fullLabel: monthKey,
    rate,
    income: 100,
    expenses: 50,
    isCurrent,
  }
}

describe('savings rate summary', () => {
  it('rounds the average of completed months down', () => {
    const { averageRate } = getSavingsRateSummary([
      point('2026-01-01', 10),
      point('2026-02-01', 15),
      point('2026-03-01', 90, true),
    ])

    // 12.5 reads 12, and the current month is left out
    expect(averageRate).toBe(12)
  })

  it('rounds a negative average down, away from zero', () => {
    const { averageRate } = getSavingsRateSummary([
      point('2026-01-01', -10),
      point('2026-02-01', -15),
      point('2026-03-01', 0, true),
    ])

    expect(averageRate).toBe(-13)
  })
})

describe('savings rate tooltip point', () => {
  const series = [point('2026-01-01', 10), point('2026-02-01', 15), point('2026-03-01', 20)]

  // Recharts reports no active bar as a null index, which Number() turned into the first bar, so the
  // tooltip named the first month while the pointer was elsewhere
  it('names no month when no bar is active', () => {
    expect(getSavingsRateTooltipPoint({ activeTooltipIndex: null }, series)).toBeUndefined()
    expect(getSavingsRateTooltipPoint({}, series)).toBeUndefined()
  })

  it('names the month of the active bar, the first one included, or the one the label names', () => {
    expect(getSavingsRateTooltipPoint({ activeTooltipIndex: 0 }, series)).toBe(series[0])
    expect(getSavingsRateTooltipPoint({ activeTooltipIndex: '2' }, series)).toBe(series[2])
    expect(getSavingsRateTooltipPoint({ activeLabel: '2026-02-01' }, series)).toBe(series[1])
  })
})
