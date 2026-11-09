/**
 * Tests the shorter forms of a card's available credit, so each rounds down, keeps the currency and
 * brackets of the full form, writes thousands to one decimal and then whole, and skips the thousands
 * for a smaller amount
 *
 * Figures are grouped the reader's way, so the amounts below assume the United States region the suite
 * pins through LC_ALL in its package script
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { getAvailableCreditForms } from '@/pages/accounts/utils/availableCreditForms'

const currencies: Currency[] = [
  { id: 'CNY', name: 'Chinese Yuan', symbol: '¥', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

describe('available credit forms', () => {
  it('shortens an amount in the thousands from its full form to whole thousands, each rounded down', () => {
    expect(getAvailableCreditForms(2_782_966, 'CNY', currencies, 'CN¥27,829.66')).toEqual([
      'CN¥27,829.66 avail.',
      'CN¥27,829 avail.',
      'CN¥27.8K avail.',
      'CN¥27K avail.',
    ])
  })

  it('has no thousands forms for an amount under a thousand', () => {
    expect(getAvailableCreditForms(70_099, 'CNY', currencies, 'CN¥700.99')).toEqual([
      'CN¥700.99 avail.',
      'CN¥700 avail.',
    ])
  })

  it('brackets a card over its limit, rounding the amount owed up', () => {
    expect(getAvailableCreditForms(-150_050, 'CNY', currencies, '(CN¥1,500.50)')).toEqual([
      '(CN¥1,500.50) avail.',
      '(CN¥1,501) avail.',
      '(CN¥1.6K) avail.',
      '(CN¥2K) avail.',
    ])
  })

  it('lists a whole form only once for a currency with no minor unit', () => {
    expect(getAvailableCreditForms(27_829, 'JPY', currencies, '¥27,829')).toEqual([
      '¥27,829 avail.',
      '¥27.8K avail.',
      '¥27K avail.',
    ])
  })
})
