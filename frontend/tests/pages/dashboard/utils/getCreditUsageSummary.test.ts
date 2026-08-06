/**
 * Tests the credit usage summary, so the percentage and amount shown cannot drift from the limit and
 * the balance behind them, in either the used or the available mode
 */
import { describe, expect, it } from 'vitest'
import { getCreditUsageSummary } from '@/pages/dashboard/utils/getCreditUsageSummary'
import { fxStatus } from './fixtures'

describe('credit usage summary', () => {
  it('summarizes credit usage for used and remaining modes', () => {
    const credit = {
      credit_limit_total: 100000,
      credit_used: 75000,
      fx_status: fxStatus,
    }

    expect(getCreditUsageSummary(credit, 'used')).toMatchObject({
      utilization: 75,
      remainingPct: 25,
      displayPct: 75,
      displayAmount: 75000,
      hasCredit: true,
      tier: 'negative',
    })
    expect(getCreditUsageSummary(credit, 'available')).toMatchObject({
      displayPct: 25,
      displayAmount: 25000,
    })
  })
})
