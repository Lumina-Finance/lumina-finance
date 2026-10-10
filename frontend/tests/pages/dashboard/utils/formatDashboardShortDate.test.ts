/**
 * Tests the compact dashboard date, so a value that is not a date is shown as it arrived
 */
import { describe, expect, it } from 'vitest'
import { formatDashboardShortDate } from '@/pages/dashboard/utils/formatDashboardShortDate'

describe('dashboard short dates', () => {
  it('formats compact dashboard dates from backend date strings', () => {
    expect(formatDashboardShortDate('2026-01-05')).toBe('Jan 5')
    expect(formatDashboardShortDate('bad-date')).toBe('bad-date')
  })
})
