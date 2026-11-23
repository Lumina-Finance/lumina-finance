/**
 * Tests the runway caption, so what a user reads under the runway figure cannot drift from the reason
 * the backend gave for it
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import type { RunwayResult } from '@/api/user'
import { getRunwayCaption } from '@/utils/runwayCaption'

const currencies: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: 'US$', minor_unit_exponent: 2 }]

const runway: RunwayResult = {
  months: 4,
  reason: null,
  avg_monthly_expense: 50000,
  months_covered: 3,
  liquid_balance: 400000,
  account_balances: [],
  thresholds: { riskyBelowMonths: 1, healthyAtMonths: 3 },
  fx_status: { state: 'none', missing_pairs: [] },
}

describe('runway caption', () => {
  it('builds runway captions', () => {
    expect(getRunwayCaption({ ...runway, reason: 'no_accounts' }, 'USD', currencies)).toBe(
      'Choose accounts in Settings',
    )
    expect(getRunwayCaption(runway, 'USD', currencies)).toContain('/mth · 3 mths basis')
  })

  it('gives the reason the expenses were left out, not that history is short, when converting them is refused', () => {
    const noHistory = { ...runway, reason: 'insufficient_history' as const }
    const withheld = {
      state: 'none' as const,
      missing_pairs: [],
      withheld_reason: 'This server allows no more of these',
    }

    expect(getRunwayCaption(noHistory, 'USD', currencies)).toBe('Need 1+ month of net expense data')
    expect(getRunwayCaption({ ...noHistory, fx_status: withheld, expenses_withheld: true }, 'USD', currencies)).toBe(
      'Amounts in your own accounts in other currencies stay out of this total. This server allows no more of these',
    )
  })

  it('still says the history is short when only a balance was left out, as with a US savings account and two weeks of Canadian spending', () => {
    const noHistory = { ...runway, reason: 'insufficient_history' as const }
    const withheld = {
      state: 'none' as const,
      missing_pairs: [],
      withheld_reason: 'This server allows no more of these',
    }

    expect(getRunwayCaption({ ...noHistory, fx_status: withheld, expenses_withheld: false }, 'USD', currencies)).toBe(
      'Need 1+ month of net expense data',
    )
  })
})
