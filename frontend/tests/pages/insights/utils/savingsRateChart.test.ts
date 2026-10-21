/**
 * Covers the savings-rate trend card's header stats, so the average of the completed months rounds
 * down like every other savings rate shown beside it
 */
import { describe, expect, it } from 'vitest'
import type { SavingsRateHistoryPoint } from '@/pages/insights/types/savingsRate'
import { getSavingsRateSummary } from '@/pages/insights/utils/savingsRateChart'

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
