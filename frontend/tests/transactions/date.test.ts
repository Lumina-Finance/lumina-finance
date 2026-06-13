/**
 * Tests transaction date helpers so visible filter and overview range labels stay stable across refactors
 */
import { describe, expect, it } from 'vitest'
import {
  formatDateRangeLabel,
  formatOverviewRangeLabel,
  getCurrentMonthOverviewRange,
} from '@/transactions/utils/date'

describe('transaction date helpers', () => {
  it('formats compact date-range filter labels', () => {
    expect(formatDateRangeLabel()).toBeNull()
    expect(formatDateRangeLabel('2026-06-01', '2026-06-30')).toBe('Jun 1 – Jun 30, 2026')
    expect(formatDateRangeLabel('2025-12-15', '2026-01-15')).toBe("Dec 15, '25 – Jan 15, '26")
    expect(formatDateRangeLabel('2026-06-01')).toBe('From Jun 1, 2026')
    expect(formatDateRangeLabel(undefined, '2026-06-30')).toBe('Until Jun 30, 2026')
  })

  it('formats full overview labels without timezone-shifting date-only inputs', () => {
    expect(formatOverviewRangeLabel('2026-06-01', '2026-06-30')).toBe('Jun 1, 2026 – Jun 30, 2026')
  })

  it('builds the current month overview range in the user timezone', () => {
    const now = new Date('2026-07-01T02:00:00Z')

    expect(getCurrentMonthOverviewRange('America/Toronto', now)).toEqual({
      monthStart: '2026-06-01',
      today: '2026-06-30',
    })
    expect(getCurrentMonthOverviewRange('UTC', now)).toEqual({
      monthStart: '2026-07-01',
      today: '2026-07-01',
    })
  })
})
