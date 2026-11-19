/**
 * Tests reading an imported amount under the format the user picked, where a cell read under the
 * wrong rules brings a different figure into the ledger
 *
 * The examples pin the odd cells banks write, such as currency text, debit markers and lookalike
 * minus signs. The properties add every supported format with and without grouping, each space
 * character and each sign, over amounts of any length, and check each amount reads back as its own
 * digits
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  IMPORT_AMOUNT_FORMATS,
  isBareImportAmount,
  readImportAmount,
  type ImportAmountFormat,
} from '@/pages/imports/utils/amountFormats'

const DECIMAL_COMMA: ImportAmountFormat = { decimalSeparator: ',', groupingSeparator: '.' }
const DECIMAL_POINT: ImportAmountFormat = { decimalSeparator: '.', groupingSeparator: ',' }

// The ordinary, non-breaking and narrow non-breaking spaces a space-grouped amount may use
const SPACE_GROUPING_CHARACTERS = [' ', ' ', ' ']

// Each sign an amount may open with, and the sign and classification its reading keeps
const SIGNS = [
  { written: '', read: '', sign: 'unsigned' },
  { written: '-', read: '-', sign: 'negative' },
  { written: '+', read: '+', sign: 'positive' },
  { written: '−', read: '-', sign: 'negative' },
] as const

/**
 * Splits whole digits into groups of three from the right, joined by the separator
 */
function groupDigits(digits: string, separator: string): string {
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end))

  return groups.join(separator)
}

/**
 * Writes an amount the way a file under one supported format would, with the reading it should give
 */
const writtenAmounts = fc
  .record({
    format: fc.constantFrom(...IMPORT_AMOUNT_FORMATS),
    whole: fc.stringMatching(/^\d{1,20}$/),
    fraction: fc.option(fc.stringMatching(/^\d{1,4}$/), { nil: undefined }),
    isGrouped: fc.boolean(),
    space: fc.constantFrom(...SPACE_GROUPING_CHARACTERS),
    sign: fc.constantFrom(...SIGNS),
  })
  .map(({ format, whole, fraction, isGrouped, space, sign }) => {
    const separator = format.groupingSeparator === 'space' ? space : format.groupingSeparator
    const writtenWhole = isGrouped && format.groupingSeparator !== 'none' ? groupDigits(whole, separator) : whole
    const writtenFraction = fraction === undefined ? '' : `${format.decimalSeparator}${fraction}`

    return {
      format,
      written: `${sign.written}${writtenWhole}${writtenFraction}`,
      reading: {
        normalized: `${sign.read}${whole}${fraction === undefined ? '' : `.${fraction}`}`,
        sign: sign.sign,
        isZero: /^0+$/.test(`${whole}${fraction ?? ''}`),
      },
    }
  })

describe('reading any amount written in a supported format', () => {
  it('reads it back as its own digits, sign and zero', () => {
    fc.assert(
      fc.property(writtenAmounts, ({ format, written, reading }) => {
        expect(readImportAmount(written, format)).toEqual(reading)
      }),
    )
  })

  it('counts it as a bare amount before any format is chosen', () => {
    fc.assert(
      fc.property(writtenAmounts, ({ written }) => {
        expect(isBareImportAmount(written)).toBe(true)
      }),
    )
  })
})

describe('reading an amount in a selected format', () => {
  it('discards surrounding text without consulting a currency list', () => {
    expect(readImportAmount('CHF100,99', DECIMAL_COMMA)?.normalized).toBe('100.99')
    expect(readImportAmount('-CHF100,99', DECIMAL_COMMA)?.normalized).toBe('-100.99')
    expect(readImportAmount('-2.112,2€', DECIMAL_COMMA)?.normalized).toBe('-2112.2')
    expect(readImportAmount('tokens 100,99 units', DECIMAL_COMMA)?.normalized).toBe('100.99')
    expect(readImportAmount('円12.34', DECIMAL_POINT)?.normalized).toBe('12.34')
    expect(readImportAmount('²12.34', DECIMAL_POINT)?.normalized).toBe('12.34')
    expect(readImportAmount('\u001C12.34\u0085', DECIMAL_POINT)?.normalized).toBe('12.34')
  })

  it.each([
    { case: 'an all Arabic-Indic amount', value: '١٢.٣٤' },
    { case: 'an all fullwidth amount', value: '１２.３４' },
    { case: 'an Arabic-Indic prefix digit', value: '١2.34' },
    { case: 'an Arabic-Indic suffix digit', value: '12.3٤' },
    { case: 'an Arabic-Indic fractional part', value: '12.٣٤' },
    { case: 'an Arabic-Indic grouping digit', value: '1,٢34.56' },
    { case: 'an Arabic-Indic final grouped digit', value: '1,23٤.56' },
    { case: 'an astral mathematical digit', value: '𝟙2.34' },
  ])('refuses $case before discarding surrounding text', ({ value }) => {
    expect(readImportAmount(value, DECIMAL_POINT)).toBeNull()
  })

  it('reads a trailing Dr as a minus and a trailing Cr as a plus', () => {
    expect(readImportAmount('250.00 Dr', DECIMAL_POINT)).toMatchObject({ normalized: '-250.00', sign: 'negative' })
    expect(readImportAmount('250.00 Cr', DECIMAL_POINT)).toMatchObject({ normalized: '+250.00', sign: 'positive' })
    expect(readImportAmount('1.234,50Dr', DECIMAL_COMMA)).toMatchObject({ normalized: '-1234.50', sign: 'negative' })
    expect(readImportAmount('75.10 dr', DECIMAL_POINT)).toMatchObject({ normalized: '-75.10', sign: 'negative' })
    expect(readImportAmount('-250.00 Dr', DECIMAL_POINT)?.normalized).toBe('-250.00')
  })

  it('refuses a marker that disagrees with a written sign and keeps other trailing words', () => {
    expect(readImportAmount('-250.00 Cr', DECIMAL_POINT)).toBeNull()
    expect(readImportAmount('+250.00 Dr', DECIMAL_POINT)).toBeNull()
    expect(readImportAmount('250.00 Andr', DECIMAL_POINT)).toMatchObject({ normalized: '250.00', sign: 'unsigned' })
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

  it('reads a sign written between leading currency text and the digits', () => {
    expect(readImportAmount('CHF-100,99', DECIMAL_COMMA)).toMatchObject({ normalized: '-100.99', sign: 'negative' })
    expect(readImportAmount('R$ − 10,00', DECIMAL_COMMA)).toMatchObject({ normalized: '-10.00', sign: 'negative' })
    expect(readImportAmount('R$ +10,00', DECIMAL_COMMA)).toMatchObject({ normalized: '+10.00', sign: 'positive' })
  })

  it.each([
    { name: 'hyphen', dash: '‐' },
    { name: 'non-breaking hyphen', dash: '‑' },
    { name: 'figure dash', dash: '‒' },
    { name: 'en dash', dash: '–' },
    { name: 'em dash', dash: '—' },
    { name: 'horizontal bar', dash: '―' },
    { name: 'small em dash', dash: '﹘' },
    { name: 'small hyphen-minus', dash: '﹣' },
    { name: 'fullwidth hyphen-minus', dash: '－' },
  ])('reads a leading $name as a minus', ({ dash }) => {
    expect(readImportAmount(`${dash}10,00`, DECIMAL_COMMA)).toMatchObject({ normalized: '-10.00', sign: 'negative' })
    expect(readImportAmount(`CHF${dash}100,99`, DECIMAL_COMMA)).toMatchObject({
      normalized: '-100.99',
      sign: 'negative',
    })
    expect(isBareImportAmount(`${dash}10.00`)).toBe(true)
    expect(readImportAmount(`100,99${dash}`, DECIMAL_COMMA)).toBeNull()
    expect(readImportAmount(`${dash}-100,99`, DECIMAL_COMMA)).toBeNull()
  })

  it('refuses signs whose meaning would be lost', () => {
    for (const value of ['--100,99', '100,99-', '(100,99)', '-R$ -10,00', 'R-$ 10,00', 'R$ -US$ 10,00']) {
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
    expect(readImportAmount('92.233.720.368.547.758,07', DECIMAL_COMMA)?.normalized).toBe('92233720368547758.07')
  })
})
