/**
 * Tests dashboard money formatting, so how far an amount is shortened cannot drift from the widget it
 * is being shown in
 */
import { describe, expect, it } from 'vitest'
import { formatDashboardMoney } from '@/pages/dashboard/utils/formatDashboardMoney'

describe('dashboard money formatting', () => {
  it('formats dashboard money using widget-specific compaction rules', () => {
    expect(formatDashboardMoney(12345678900, 'USD', 'netWorth')).toBe('≈US$123M')
    expect(formatDashboardMoney(12345678, 'USD', 'credit')).toBe('≈US$123K')
    expect(formatDashboardMoney(123456, 'USD', 'breakdown')).toBe('≈US$2K')
    expect(formatDashboardMoney(123456, 'USD', 'raw')).toBe('US$1,234.56')
  })
})
