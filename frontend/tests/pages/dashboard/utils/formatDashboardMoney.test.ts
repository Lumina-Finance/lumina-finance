/**
 * Tests dashboard money formatting, so how far an amount is shortened and which way it rounds cannot
 * drift from the widget it is being shown in
 *
 * A currency's symbol is written the reader's way, so the amounts below assume the region the suite
 * pins through LC_ALL in its package script: read from the United States, where US dollars are the
 * plain ones and Canadian dollars are marked CA$
 */
import { describe, expect, it } from 'vitest'
import { formatDashboardMoney } from '@/pages/dashboard/utils/formatDashboardMoney'
import { currencies } from './fixtures'

describe('dashboard money formatting', () => {
  it('formats dashboard money using widget-specific compaction rules, one decimal in K and M', () => {
    expect(formatDashboardMoney(12345678900, 'USD', 'netWorth', currencies, 'down')).toBe('≈$123.4M')
    expect(formatDashboardMoney(12345678, 'USD', 'credit', currencies, 'up')).toBe('≈$123.5K')
    expect(formatDashboardMoney(123456, 'USD', 'breakdown', currencies, 'up')).toBe('≈$1.3K')
    expect(formatDashboardMoney(123456, 'USD', 'raw', currencies, 'up')).toBe('$1,234.56')
  })

  it('reads an expense of 2,987 as 3.0K and an income of 2,987 as 2.9K', () => {
    expect(formatDashboardMoney(2_987_00, 'USD', 'breakdown', currencies, 'up')).toBe('≈$3.0K')
    expect(formatDashboardMoney(2_987_00, 'USD', 'breakdown', currencies, 'down')).toBe('≈$2.9K')
  })

  it('reads an expense that rounds up to a million as a million, and an income rounded down as thousands', () => {
    expect(formatDashboardMoney(999_950_00, 'USD', 'breakdown', currencies, 'up')).toBe('≈$1.0M')
    expect(formatDashboardMoney(999_950_00, 'USD', 'breakdown', currencies, 'down')).toBe('≈$999.9K')
  })

  it('shows a credit amount below the first threshold in full, cents included, whichever way it rounds', () => {
    expect(formatDashboardMoney(5_000_40, 'USD', 'credit', currencies, 'up')).toBe('$5,000.40')
    expect(formatDashboardMoney(99_999_99, 'USD', 'credit', currencies, 'up')).toBe('$99,999.99')
    expect(formatDashboardMoney(99_999_99, 'USD', 'credit', currencies, 'down')).toBe('$99,999.99')
    expect(formatDashboardMoney(0, 'USD', 'credit', currencies, 'down')).toBe('$0.00')
    // At the threshold it compacts, to a tenth of a thousand
    expect(formatDashboardMoney(250_000_00, 'USD', 'credit', currencies, 'down')).toBe('≈$250.0K')
  })

  it('keeps cents below the smallest rule for the formats that are not whole', () => {
    expect(formatDashboardMoney(999_99, 'USD', 'breakdown', currencies, 'up')).toBe('$999.99')
    expect(formatDashboardMoney(500_000_00, 'USD', 'netWorth', currencies, 'down')).toBe('$500,000.00')
  })
})
