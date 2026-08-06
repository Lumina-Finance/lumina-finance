/**
 * Tests the compact dashboard date, so a value the calendar does not have or one carrying a time is
 * shown as it arrived rather than quietly moved to another day
 */
import { describe, expect, it } from 'vitest'
import { formatDashboardShortDate } from '@/pages/dashboard/utils/formatDashboardShortDate'

describe('dashboard short dates', () => {
  it('formats compact dashboard dates from backend date strings', () => {
    expect(formatDashboardShortDate('2026-01-05')).toBe('Jan 5')
    expect(formatDashboardShortDate('bad-date')).toBe('bad-date')
  })

  it('keeps a dashboard date the calendar does not have instead of rolling it forward', () => {
    expect(formatDashboardShortDate('2026-02-31')).toBe('2026-02-31')
  })

  it('refuses a dashboard date carrying a time, which the API never sends', () => {
    expect(formatDashboardShortDate('2026-01-05T00:00:00')).toBe('2026-01-05T00:00:00')
  })
})
