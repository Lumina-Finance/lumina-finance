/**
 * Guards the archive warning in the account edit dialog, which writes the adjustment it will record.
 * That adjustment is an amount that moved, so it is signed like the row it becomes: a true minus
 * before it in every language, and a plus on a gain. It was written as a held balance, which gave a
 * hyphen in German, brackets in Japanese and a language's own minus in Finnish
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    currencies,
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, currencies),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, currencies),
  }),
}))

import { ArchiveBalanceWarning } from '@/pages/accounts/detail/components/edit-identity/controls/ArchiveBalanceWarning'

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

/** Renders the warning for an account holding the balance and returns its text */
function warningText(balance: number) {
  return renderToStaticMarkup(<ArchiveBalanceWarning balance={balance} currency="CAD" />).replace(/<[^>]+>/g, '')
}

afterEach(() => vi.unstubAllGlobals())

describe('archive balance warning', () => {
  it.each([
    ['de-DE', 50000, `−500,00${NBSP}CA$ will be recorded`],
    ['ja-JP', 50000, `−CA$500.00 will be recorded`],
    ['fi-FI', 50000, `−500,00${NBSP}CAD will be recorded`],
    ['de-DE', -4250, `+42,50${NBSP}CA$ will be recorded`],
  ])('writes the adjustment for a %s reader holding %s', (locale, balance, expected) => {
    readAs(locale)
    expect(warningText(balance)).toContain(expected)
  })

  it('records nothing for an account that already holds zero', () => {
    expect(warningText(0)).toContain('no balance adjustment will be recorded')
  })
})
