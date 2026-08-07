/**
 * Tests dashboard money formatting, so how far an amount is shortened cannot drift from the widget it
 * is being shown in
 *
 * A currency's symbol is written the reader's way, so the amounts below assume the region the suite
 * pins through LC_ALL in its package script: read from the United States, where US dollars are the
 * plain ones and Canadian dollars are marked CA$
 */
import { describe, expect, it } from 'vitest'
import { formatDashboardMoney } from '@/pages/dashboard/utils/formatDashboardMoney'
import { currencies } from './fixtures'

describe('dashboard money formatting', () => {
  it('formats dashboard money using widget-specific compaction rules', () => {
    expect(formatDashboardMoney(12345678900, 'USD', 'netWorth', currencies)).toBe('≈$123M')
    expect(formatDashboardMoney(12345678, 'USD', 'credit', currencies)).toBe('≈$123K')
    expect(formatDashboardMoney(123456, 'USD', 'breakdown', currencies)).toBe('≈$2K')
    expect(formatDashboardMoney(123456, 'USD', 'raw', currencies)).toBe('$1,234.56')
  })
})
