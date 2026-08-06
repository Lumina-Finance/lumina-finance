/**
 * Tests the account FX tooltip messages so what a user is told about a missing conversion rate cannot
 * drift from the status the backend reported
 */
import { describe, expect, it } from 'vitest'
import {
  getAccountBalanceFxStatusMessage,
  getAccountSummaryFxStatusMessage,
} from '@/pages/accounts/utils/fxTooltipMessages'

describe('summary FX status messages', () => {
  it('explains incomplete account totals when some conversion rates are missing', () => {
    expect(getAccountSummaryFxStatusMessage({
      state: 'incomplete',
      missing_pairs: [{ base: 'USD', quote: 'CAD' }],
    })).toBe('Some foreign currency accounts could not be converted. Account totals are incomplete and only include accounts with available conversion rates')
  })

  it('explains unavailable row-level account balance conversion', () => {
    expect(getAccountBalanceFxStatusMessage({
      state: 'unavailable',
      missing_pairs: [{ base: 'USD', quote: 'CAD' }],
    })).toBe('This account balance could not be converted into your base currency')
  })
})
