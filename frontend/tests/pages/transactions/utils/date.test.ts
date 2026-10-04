/**
 * Tests transaction date helpers so the overview range follows the user's timezone rather than the browser's
 */
import { describe, expect, it } from 'vitest'
import { getCurrentMonthOverviewRange } from '@/pages/transactions/utils/date'

describe('transaction date helpers', () => {
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
