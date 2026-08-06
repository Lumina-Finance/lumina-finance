/**
 * Tests that the Firefly III create-new prefills only ever offer a currency the app can store an
 * account in, since the count above the mapping table reads a row carrying a type and a currency as
 * answered while the control beside it shows a placeholder for a code its own list does not hold
 */
import { describe, expect, it } from 'vitest'
import type { CsvRow } from '@/pages/imports/types'
import { buildFireflyAccountPrefills } from '@/pages/imports/firefly/utils'

const SUPPORTED_CURRENCIES = new Set(['CAD', 'USD'])

/**
 * Creates a Firefly withdrawal leaving the given asset account in the given currency
 */
function createWithdrawal(sourceName: string, currencyCode: string, overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    journal_id: '1',
    type: 'Withdrawal',
    date: '2026-06-11 00:00:00',
    amount: '-12.34',
    currency_code: currencyCode,
    foreign_amount: '',
    foreign_currency_code: '',
    description: 'Weekly shop',
    source_name: sourceName,
    source_type: 'Asset account',
    destination_name: 'Market',
    destination_type: 'Expense account',
    category: 'Groceries',
    tags: '',
    notes: '',
    ...overrides,
  }
}

describe('the currency a Firefly account is prefilled with', () => {
  it('takes the code every row of the account states', () => {
    const rows = [createWithdrawal('Chequing', 'CAD'), createWithdrawal('Chequing', 'CAD')]

    expect(buildFireflyAccountPrefills(rows, ['Chequing'], SUPPORTED_CURRENCIES).Chequing.currency).toBe('CAD')
  })

  // Three characters is all the export is asked for, so a code the app cannot store an account in
  // reaches here. Prefilled, it would leave the row counted as answered with an empty-looking
  // currency box, and the commit would send the server a currency it refuses
  it('leaves the box empty for a code the app does not support', () => {
    const rows = [createWithdrawal('Crypto Wallet', 'BTC'), createWithdrawal('Crypto Wallet', 'BTC')]

    expect(buildFireflyAccountPrefills(rows, ['Crypto Wallet'], SUPPORTED_CURRENCIES)['Crypto Wallet'].currency).toBe('')
  })

  // The overall vote stands in for an account whose own rows say nothing, so an unsupported code
  // must not win there either
  it('does not let an unsupported code become the fallback for another account', () => {
    const rows = [
      createWithdrawal('Crypto Wallet', 'BTC'),
      createWithdrawal('Crypto Wallet', 'BTC'),
      createWithdrawal('Chequing', 'CAD'),
    ]

    const prefills = buildFireflyAccountPrefills(rows, ['Crypto Wallet', 'Savings'], SUPPORTED_CURRENCIES)
    expect(prefills.Savings.currency).toBe('CAD')
  })

  it('ignores an unsupported foreign currency on a transfer', () => {
    const rows = [
      createWithdrawal('Chequing', 'CAD', {
        type: 'Transfer',
        destination_name: 'Savings',
        destination_type: 'Asset account',
        foreign_currency_code: 'BTC',
      }),
    ]

    expect(buildFireflyAccountPrefills(rows, ['Savings'], SUPPORTED_CURRENCIES).Savings.currency).toBe('CAD')
  })
})
