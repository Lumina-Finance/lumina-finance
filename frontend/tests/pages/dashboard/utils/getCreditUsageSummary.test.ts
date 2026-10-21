/**
 * Tests the credit usage summary, so the percentage and amount shown cannot drift from the limit and
 * the balance behind them, in either the used or the available mode, and neither reads better than it
 * is: credit used and its utilization round up, credit left rounds down
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
      displayAmountRounding: 'up',
      hasCredit: true,
      tier: 'negative',
    })
    expect(getCreditUsageSummary(credit, 'available')).toMatchObject({
      displayPct: 25,
      displayAmount: 25000,
      displayAmountRounding: 'down',
    })
  })

  it('rounds utilization up, so the share left reads as less rather than more', () => {
    const credit = { credit_limit_total: 300000, credit_used: 100000, fx_status: fxStatus }

    // A third used is 33.3%
    expect(getCreditUsageSummary(credit, 'used')).toMatchObject({ utilization: 34, remainingPct: 66 })
    expect(getCreditUsageSummary({ ...credit, credit_used: 150000 }, 'used').utilization).toBe(50)
  })
})
