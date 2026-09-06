import { describe, expect, it } from 'vitest'
import { readImportAmount, type ImportAmountFormat } from '@/pages/imports/utils/amountFormats'

const DECIMAL_COMMA: ImportAmountFormat = { decimalSeparator: ',', groupingSeparator: '.' }
const DECIMAL_POINT: ImportAmountFormat = { decimalSeparator: '.', groupingSeparator: ',' }

describe('reading an amount in a selected format', () => {
  it('discards surrounding text without consulting a currency list', () => {
    expect(readImportAmount('CHF100,99', DECIMAL_COMMA)?.normalized).toBe('100.99')
    expect(readImportAmount('-CHF100,99', DECIMAL_COMMA)?.normalized).toBe('-100.99')
    expect(readImportAmount('-2.112,2€', DECIMAL_COMMA)?.normalized).toBe('-2112.2')
    expect(readImportAmount('tokens 100,99 units', DECIMAL_COMMA)?.normalized).toBe('100.99')
  })

  it('retains leading signs and recognizes the Unicode minus sign', () => {
    expect(readImportAmount('+CHF100,99', DECIMAL_COMMA)).toMatchObject({
      normalized: '+100.99',
      sign: 'positive',
      isZero: false,
    })
    expect(readImportAmount('−CHF100,99', DECIMAL_COMMA)).toMatchObject({
      normalized: '-100.99',
      sign: 'negative',
      isZero: false,
    })
  })

  it('refuses signs whose meaning would be lost', () => {
    for (const value of ['--100,99', '100,99-', '(100,99)', 'CHF-100,99']) {
      expect(readImportAmount(value, DECIMAL_COMMA)).toBeNull()
    }
  })

  it('refuses values without digits and text within the digits', () => {
    for (const value of ['CHF', '€', '12abc34', '1e3', '-', '.5', 'USD.5']) {
      expect(readImportAmount(value, DECIMAL_POINT)).toBeNull()
    }
  })

  it('accepts the three space grouping characters as one choice', () => {
    const format: ImportAmountFormat = { decimalSeparator: ',', groupingSeparator: 'space' }

    for (const value of ['1 234,56', '1 234,56', '1 234,56']) {
      expect(readImportAmount(value, format)?.normalized).toBe('1234.56')
    }
  })

  it('accepts apostrophe grouping and refuses malformed groups', () => {
    const apostrophe: ImportAmountFormat = { decimalSeparator: '.', groupingSeparator: "'" }

    expect(readImportAmount("1'234.56", apostrophe)?.normalized).toBe('1234.56')
    expect(readImportAmount('12,34.56', DECIMAL_POINT)).toBeNull()
  })

  it('refuses matching decimal and grouping separators', () => {
    expect(readImportAmount('1,234', { decimalSeparator: ',', groupingSeparator: ',' })).toBeNull()
    expect(readImportAmount('1.234', { decimalSeparator: '.', groupingSeparator: '.' })).toBeNull()
  })

  it('classifies zero by its decimal digits without number conversion', () => {
    const tiny = `0,${'0'.repeat(324)}1`

    expect(readImportAmount(tiny, DECIMAL_COMMA)).toMatchObject({ isZero: false, sign: 'unsigned' })
    expect(readImportAmount(`-0,${'0'.repeat(325)}`, DECIMAL_COMMA)).toMatchObject({
      isZero: true,
      sign: 'negative',
    })
  })

  it('retains every decimal digit for exact minor-unit conversion', () => {
    expect(readImportAmount('12,3400', DECIMAL_COMMA)?.normalized).toBe('12.3400')
    expect(readImportAmount('92.233.720.368.547.758,07', DECIMAL_COMMA)?.normalized)
      .toBe('92233720368547758.07')
  })
})
