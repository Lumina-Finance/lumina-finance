/**
 * Covers the bank link section's balance panel: the bank's balance beside the ledger's, the ledger
 * against the bank, the caption with the balance date and any available balance, and the footer
 * under it
 *
 * These tests catch a match that reads as a gap or offers the tooltip, a gap without its sign, its
 * warning colour or its tooltip, a gap signed the wrong way round, a card's negative balances written
 * as positive, an available balance shown when the bank gives none or dropped when it does, a
 * balance that can't be read exactly shown as an amount or compared, and an available balance that
 * can't be read exactly dropped from the caption as if the bank gave none, and a footer set above the
 * caption, or leaving anything behind when there is none
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankBalance } from '@/api/bank-sync'
import type { Currency } from '@/api/currency'
import { formatCurrency, formatMovedCurrency } from '@/utils/formatCurrency'

const CURRENCIES: Currency[] = [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    formatCurrency: (amount: number, currency: string) => formatCurrency(amount, currency, CURRENCIES),
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, CURRENCIES),
  }),
}))
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', tz: 'America/Toronto' }, accessToken: 'token' }),
}))

import { BalancePanel } from '@/pages/accounts/detail/components/bank-link/BalancePanel'

const MINUS = String.fromCodePoint(0x2212)

/** Builds SimpleFIN's 1,250.00 as of 6:00 PM on October 3 in Toronto against a ledger that matches, with no available balance */
function createBalance(overrides: Partial<BankBalance> = {}): BankBalance {
  return {
    amount: 125000,
    available: null,
    available_unreadable: false,
    balance_date: '2026-10-03T22:00:00Z',
    ledger_balance: 125000,
    difference: 0,
    ...overrides,
  }
}

function renderPanel(balance: BankBalance): string {
  return renderToStaticMarkup(<BalancePanel balance={balance} currency="CAD" providerName="SimpleFIN" />)
}

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replaceAll('&#x27;', "'")
    .trim()
}

/** Each fact's label, without any tooltip after it, and its value, in the order they show */
function readFacts(markup: string): [string, string][] {
  return [...markup.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(([, term, value]) => [
    textOf(term.split('<span')[0]),
    textOf(value),
  ])
}

/** The colour of the value of the fact the label names */
function readColour(markup: string, label: string): string | undefined {
  const facts = [...markup.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*style="color:([^"]*)"/g)]
  return facts.find(([, term]) => textOf(term.split('<span')[0]) === label)?.[2]
}

/** The names of the tooltips the panel offers, in the order they show */
function readTooltips(markup: string): string[] {
  return [...markup.matchAll(/aria-label="([^"]*)"/g)].map(([, name]) => name)
}

function readCaption(markup: string): string {
  return textOf(markup.match(/<p [^>]*>(.*?)<\/p>/)![1])
}

describe('bank balance panel', () => {
  it('reads None in the positive colour without a tooltip when the ledger matches the bank', () => {
    const markup = renderPanel(createBalance())

    expect(readFacts(markup)).toEqual([
      ['SimpleFIN', 'CA$1,250.00'],
      ['Ledger', 'CA$1,250.00'],
      ['Difference', 'None'],
    ])
    expect(readColour(markup, 'Difference')).toBe('var(--app-positive)')
    expect(readTooltips(markup)).toEqual([])
    expect(readCaption(markup)).toMatch(/^As of Oct 3, 6:00\sp\.m\.$/)
  })

  it.each([
    { bank: 120000, difference: 5000, shown: '+CA$50.00' },
    { bank: 130000, difference: -5000, shown: `${MINUS}CA$50.00` },
  ])(
    'gives the ledger against the bank of $bank as $shown in the warning colour, with the tooltip',
    ({ bank, difference, shown }) => {
      const markup = renderPanel(createBalance({ amount: bank, difference }))

      expect(readFacts(markup)[2]).toEqual(['Difference', shown])
      expect(readColour(markup, 'Difference')).toBe('var(--app-warning-text)')
      expect(readTooltips(markup)).toEqual(['Why the balances differ'])
    },
  )

  it('writes what a card owes as negative balances, held amounts in parentheses', () => {
    const markup = renderPanel(createBalance({ amount: -120000, ledger_balance: -125000, difference: -5000 }))

    expect(readFacts(markup)).toEqual([
      ['SimpleFIN', '(CA$1,200.00)'],
      ['Ledger', '(CA$1,250.00)'],
      ['Difference', `${MINUS}CA$50.00`],
    ])
  })

  it('adds the available balance to the caption when SimpleFIN gives one', () => {
    const markup = renderPanel(createBalance({ available: 118000 }))

    expect(readCaption(markup)).toMatch(/^As of Oct 3, 6:00\sp\.m\. · CA\$1,180\.00 available$/)
  })

  it("shows a balance that can't be read exactly as unavailable, saying why, with no Difference", () => {
    const markup = renderPanel(createBalance({ amount: null, difference: null }))

    expect(readFacts(markup)).toEqual([
      ['SimpleFIN', 'Unavailable'],
      ['Ledger', 'CA$1,250.00'],
    ])
    expect(readColour(markup, 'SimpleFIN')).toBe('var(--app-text-muted)')
    expect(readTooltips(markup)).toEqual(['Why the balance is unavailable'])
  })

  it("marks an available balance that can't be read exactly as unavailable in the caption, saying why", () => {
    const markup = renderPanel(createBalance({ available_unreadable: true }))

    expect(readCaption(markup)).toMatch(/^As of Oct 3, 6:00\sp\.m\. · Available balance unavailable/)
    expect(readTooltips(markup)).toEqual(['Why the available balance is unavailable'])
  })

  it('puts a footer under the caption, and nothing there without one', () => {
    const footer = <p data-testid="footer">Offer</p>
    const markup = renderToStaticMarkup(
      <BalancePanel balance={createBalance()} currency="CAD" providerName="SimpleFIN" footer={footer} />,
    )
    const withoutFooter = renderToStaticMarkup(
      <BalancePanel balance={createBalance()} currency="CAD" providerName="SimpleFIN" footer={null} />,
    )

    expect(markup).toMatch(/As of .*data-testid="footer"/s)
    expect(withoutFooter).toBe(renderPanel(createBalance()))
  })
})
