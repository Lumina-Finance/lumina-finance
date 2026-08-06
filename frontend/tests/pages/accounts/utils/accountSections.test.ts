/**
 * Tests how the account list is grouped into sections, so the totals, the row order within each
 * section and the combined FX status cannot drift from the accounts they are built from
 */
import { describe, expect, it } from 'vitest'
import {
  getAccountSections,
  getCombinedAccountFxStatus,
} from '@/pages/accounts/utils/accountSections'
import { createAccount } from './fixtures'

describe('account section helpers', () => {
  it('uses base-currency balances for totals and sorts visible rows by section rules', () => {
    const rows = [
      createAccount({
        id: 'savings',
        account_kind: 'asset',
        account_type: 'savings',
        current_balance: 300,
        base_currency_current_balance: 900,
      }),
      createAccount({
        id: 'checking',
        account_kind: 'asset',
        account_type: 'checking',
        current_balance: 700,
      }),
      createAccount({
        id: 'card',
        account_kind: 'revolving',
        account_type: 'credit_card',
        current_balance: -500,
      }),
      createAccount({
        id: 'loan',
        account_kind: 'amortizing',
        account_type: 'loan',
        current_balance: -4_000,
      }),
    ]
    const sections = getAccountSections({ rows, filteredRows: rows })

    expect(sections.totalAssets).toBe(1_600)
    expect(sections.totalDebts).toBe(-4_500)
    expect(sections.netWorth).toBe(-2_900)
    expect(sections.assetRows.map((account) => account.id)).toEqual(['savings', 'checking'])
    expect(sections.revolvingRows.map((account) => account.id)).toEqual(['card'])
    expect(sections.amortizingRows.map((account) => account.id)).toEqual(['loan'])
  })

  it('combines duplicate missing FX pairs once and keeps incomplete status when some conversions are unavailable', () => {
    const rows = [
      createAccount({
        id: 'cad',
        current_balance_fx_status: {
          state: 'incomplete',
          missing_pairs: [{ base: 'USD', quote: 'CAD' }],
        },
      }),
      createAccount({
        id: 'eur',
        current_balance_fx_status: {
          state: 'unavailable',
          missing_pairs: [
            { base: 'USD', quote: 'CAD' },
            { base: 'USD', quote: 'EUR' },
          ],
        },
      }),
      createAccount({ id: 'usd' }),
    ]

    expect(getCombinedAccountFxStatus(rows)).toEqual({
      state: 'incomplete',
      missing_pairs: [
        { base: 'USD', quote: 'CAD' },
        { base: 'USD', quote: 'EUR' },
      ],
    })
  })
})
