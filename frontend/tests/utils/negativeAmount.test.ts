/**
 * Tests how a negative amount is written for each kind of amount in each style, and that the sign
 * is the same in every language, whatever the language's own accounting style would do
 *
 * The style comes only from `getNegativeStyle`, so each case sets what it returns for a kind. The
 * language is the reader's own, so each case swaps the browser's locale for the one it names
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import type { MoneyKind, NegativeStyle } from '@/utils/negativeStyle'

const styles = vi.hoisted(() => ({ held: 'brackets', moved: 'minus' }) as Record<MoneyKind, NegativeStyle>)

vi.mock('@/utils/negativeStyle', () => ({ getNegativeStyle: (kind: MoneyKind) => styles[kind] }))

import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'
import {
  getAmountSign,
  getAmountSignColor,
  getShownAmountSign,
  getSignedAmountColor,
  formatMovedPercent,
  formatRatePercent,
  signMovedAmount,
} from '@/utils/negativeAmount'

const currencies: Currency[] = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]

const NBSP = ' '
const MINUS = '−'

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

afterEach(() => {
  vi.unstubAllGlobals()
  styles.held = 'brackets'
  styles.moved = 'minus'
})

describe('direction of an amount', () => {
  it('reads zero and negative zero as no direction', () => {
    expect([getAmountSign(5), getAmountSign(-5), getAmountSign(0), getAmountSign(-0)]).toEqual([1, -1, 0, 0])
    expect([getAmountSign(5n), getAmountSign(-5n), getAmountSign(0n)]).toEqual([1, -1, 0])
  })

  it('reads an amount that rounds to zero as no direction', () => {
    expect([
      getShownAmountSign(0.4),
      getShownAmountSign(-0.4),
      getShownAmountSign(0.6),
      getShownAmountSign(-0.6),
    ]).toEqual([0, 0, 1, -1])
  })
})

describe('an amount that moved', () => {
  // The adjustment an archived account's warning will record, and a transaction, for readers of
  // several languages. A hyphen, brackets and the language's own minus all used to appear here
  it.each([
    ['en-US', -4250, `${MINUS}CA$42.50`],
    ['en-US', 4250, '+CA$42.50'],
    ['de-DE', -4250, `${MINUS}42,50${NBSP}CA$`],
    ['de-DE', 4250, `+42,50${NBSP}CA$`],
    ['ja-JP', -50000, `${MINUS}CA$500.00`],
    ['fi-FI', -50000, `${MINUS}500,00${NBSP}CAD`],
    ['fr-FR', -4250, `${MINUS}42,50${NBSP}$CA`],
  ])('reads %s %s as %s with the minus style', (locale, minorUnits, expected) => {
    readAs(locale)
    expect(formatMovedCurrency(minorUnits, 'CAD', currencies)).toBe(expected)
  })

  it('wraps money out in brackets and still marks money in with a plus in the brackets style', () => {
    styles.moved = 'brackets'
    readAs('de-DE')
    expect(formatMovedCurrency(-4250, 'CAD', currencies)).toBe(`(42,50${NBSP}CA$)`)
    expect(formatMovedCurrency(4250, 'CAD', currencies)).toBe(`+42,50${NBSP}CA$`)
  })

  it('leaves zero unsigned, including an amount that rounds to zero', () => {
    for (const amount of [0, -0, 0.4, -0.4]) {
      expect(formatMovedCurrency(amount, 'CAD', currencies)).toBe('CA$0.00')
    }
    expect(formatMovedCurrency(0.6, 'CAD', currencies)).toBe('+CA$0.01')
    expect(formatMovedCurrency(-0.6, 'CAD', currencies)).toBe(`${MINUS}CA$0.01`)
  })

  it('signs an already formatted magnitude in the moved style', () => {
    expect([1, -1, 0].map((sign) => signMovedAmount(sign as 1 | -1 | 0, '$5.00'))).toEqual([
      '+$5.00',
      `${MINUS}$5.00`,
      '$5.00',
    ])
    styles.moved = 'brackets'
    expect(signMovedAmount(-1, '$5.00')).toBe('($5.00)')
  })

  it('signs a percentage change the same way as the amount', () => {
    expect([formatMovedPercent(12), formatMovedPercent(-12), formatMovedPercent(0)]).toEqual([
      '+12%',
      `${MINUS}12%`,
      '0%',
    ])
    expect(formatMovedPercent(-25, 1)).toBe(`${MINUS}25.0%`)
    expect(formatMovedPercent(-0.04, 1)).toBe('0.0%')
  })
})

describe('a savings rate', () => {
  // With income near zero the rate runs into the millions, and it used to print raw, as -62345579%
  it.each([
    [999, '999%'],
    [1000, 'above 999%'],
    [999.5, 'above 999%'],
    [-999, `${MINUS}999%`],
    [-999.5, `below ${MINUS}999%`],
    [-1000, `below ${MINUS}999%`],
    [-62345579, `below ${MINUS}999%`],
    [-15, `${MINUS}15%`],
    [0, '0%'],
  ])('writes a rate of %s as %s', (rate, expected) => {
    expect(formatRatePercent(rate)).toBe(expected)
  })
})

describe('the colour of an amount', () => {
  it('colours each direction, and zero and an amount that shows as zero in the neutral text colour', () => {
    expect([getSignedAmountColor(500), getSignedAmountColor(-500)]).toEqual([
      'var(--app-positive)',
      'var(--app-negative)',
    ])
    expect([
      getSignedAmountColor(0),
      getSignedAmountColor(-0),
      getSignedAmountColor(0.4),
      getSignedAmountColor(-0.4),
    ]).toEqual(Array(4).fill('var(--app-text)'))
  })

  it('gives zero the quieter neutral a change figure asks for, and leaves the other directions alone', () => {
    expect([0, 0.4, 500, -500].map((amount) => getSignedAmountColor(amount, 'var(--app-text-muted)'))).toEqual([
      'var(--app-text-muted)',
      'var(--app-text-muted)',
      'var(--app-positive)',
      'var(--app-negative)',
    ])
  })

  it('colours a direction on its own, for a figure whose colour is the other way round', () => {
    expect([getAmountSignColor(1), getAmountSignColor(0), getAmountSignColor(-1)]).toEqual([
      'var(--app-positive)',
      'var(--app-text)',
      'var(--app-negative)',
    ])
  })
})

describe('a held amount', () => {
  it.each([
    ['en-US', '(CA$500.00)'],
    ['ja-JP', '(CA$500.00)'],
    ['de-DE', `(500,00${NBSP}CA$)`],
  ])('wraps a negative in brackets for a %s reader', (locale, expected) => {
    readAs(locale)
    expect(formatCurrency(-50000, 'CAD', currencies)).toBe(expected)
  })

  it('writes a true minus before the whole amount in the minus style', () => {
    styles.held = 'minus'
    readAs('de-DE')
    expect(formatCurrency(-50000, 'CAD', currencies)).toBe(`${MINUS}500,00${NBSP}CA$`)
  })

  it('leaves a positive and an amount that rounds to zero unmarked in either style', () => {
    for (const style of ['brackets', 'minus'] as const) {
      styles.held = style
      expect(formatCurrency(50000, 'CAD', currencies)).toBe('CA$500.00')
      expect(formatCurrency(-0.4, 'CAD', currencies)).toBe('CA$0.00')
    }
  })
})
