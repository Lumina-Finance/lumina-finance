/**
 * Tests the one place that decides how a negative amount is written: the style each kind of amount
 * takes today, how an amount that moved is signed in each style, and that the true minus and the plus
 * are the same in every language, whatever the language's own accounting style would do
 *
 * The language is the reader's own, so each case below runs with the browser's locale swapped for
 * the one it names
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import { formatCurrency, formatMovedCurrency, formatMajorUnits } from '@/utils/formatCurrency'
import { getAmountSign, getNegativeStyle, signMovedAmount } from '@/utils/negativeStyle'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

const NBSP = ' '

/** Makes every number format that names no locale read as the given one, until it is unstubbed */
function readAs(locale: string) {
  const Original = Intl.NumberFormat
  class Localized extends Original {
    constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      super(locales ?? locale, options)
    }
  }
  vi.stubGlobal('Intl', Object.create(Intl, { NumberFormat: { value: Localized } }))
}

afterEach(() => vi.unstubAllGlobals())

describe('negative style', () => {
  it('writes a held negative in brackets and a moved negative with a true minus', () => {
    expect(getNegativeStyle('held')).toBe('brackets')
    expect(getNegativeStyle('moved')).toBe('minus')
  })

  it('reads zero and negative zero as no direction', () => {
    expect([getAmountSign(5), getAmountSign(-5), getAmountSign(0), getAmountSign(-0)]).toEqual([1, -1, 0, 0])
    expect([getAmountSign(5n), getAmountSign(-5n), getAmountSign(0n)]).toEqual([1, -1, 0])
  })

  it.each([
    ['minus', 1, '+$5.00'],
    ['minus', -1, '−$5.00'],
    ['minus', 0, '$5.00'],
    ['brackets', 1, '+$5.00'],
    ['brackets', -1, '($5.00)'],
    ['brackets', 0, '$5.00'],
  ] as const)('signs a moved amount in the %s style, direction %s, as %s', (style, sign, expected) => {
    expect(signMovedAmount(sign, '$5.00', style)).toBe(expected)
  })

  it('signs a moved amount in the style set for moved amounts when none is given', () => {
    expect(signMovedAmount(-1, '$5.00')).toBe('−$5.00')
  })
})

describe('an amount that moved, in every language', () => {
  // The adjustment an archived account's warning will record, and a transaction, for a German,
  // Japanese and Finnish reader. A plain hyphen, brackets and the language's own minus all used to
  // appear here depending on the language
  it.each([
    ['en-US', -4250, `−CA$42.50`],
    ['en-US', 4250, `+CA$42.50`],
    ['de-DE', -4250, `−42,50${NBSP}CA$`],
    ['de-DE', 4250, `+42,50${NBSP}CA$`],
    ['ja-JP', -50000, `−CA$500.00`],
    ['ja-JP', 50000, `+CA$500.00`],
    ['fi-FI', -50000, `−500,00${NBSP}CAD`],
    ['fi-FI', 50000, `+500,00${NBSP}CAD`],
    ['fr-FR', -4250, `−42,50${NBSP}$CA`],
    ['da-DK', -4250, `−42,50${NBSP}CA$`],
  ])('reads %s %s as %s', (locale, minorUnits, expected) => {
    readAs(locale)
    expect(formatMovedCurrency(minorUnits, 'CAD', currencies)).toBe(expected)
  })

  it('leaves a zero amount unsigned in every language', () => {
    for (const locale of ['en-US', 'de-DE', 'ja-JP', 'fi-FI']) {
      readAs(locale)
      expect(formatMovedCurrency(0, 'CAD', currencies)).toBe(formatCurrency(0, 'CAD', currencies))
      expect(formatMovedCurrency(-0, 'CAD', currencies)).toBe(formatCurrency(0, 'CAD', currencies))
      vi.unstubAllGlobals()
    }
  })

  it('never writes a hyphen or brackets', () => {
    for (const locale of ['en-US', 'de-DE', 'ja-JP', 'fi-FI', 'fr-FR', 'da-DK']) {
      readAs(locale)
      expect(formatMovedCurrency(-12345, 'CAD', currencies)).not.toMatch(/[-()]/)
      vi.unstubAllGlobals()
    }
  })
})

describe('a held amount', () => {
  it('keeps the brackets its negative has always had in the reader\'s own style', () => {
    readAs('en-US')
    expect(formatCurrency(-50000, 'CAD', currencies)).toBe('(CA$500.00)')
    readAs('ja-JP')
    expect(formatCurrency(-50000, 'CAD', currencies)).toBe('(CA$500.00)')
  })

  it('writes the same true minus in every language when its style is minus', () => {
    for (const [locale, expected] of [
      ['en-US', '−CA$500.00'],
      ['de-DE', `−500,00${NBSP}CA$`],
      ['fi-FI', `−500,00${NBSP}CAD`],
    ]) {
      readAs(locale)
      expect(formatMajorUnits(-500, 'CAD', 2, 'minus')).toBe(expected)
      vi.unstubAllGlobals()
    }
  })

  it('writes an amount that rounds to zero unsigned in either style', () => {
    expect(formatMajorUnits(-0.004, 'CAD', 2, 'minus')).toBe('CA$0.00')
    expect(formatMajorUnits(-0.004, 'CAD', 2, 'brackets')).toBe('CA$0.00')
  })
})
