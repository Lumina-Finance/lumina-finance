/**
 * Covers the filing card a new bank item is reviewed against: each field the provider sent, under its
 * label and in order, what the card shows for a value the provider didn't send, an amount its currency
 * can't hold, and what heads the card for an account with no link to name
 *
 * These tests catch a field dropped, relabelled or moved, a missing value left blank rather than "—",
 * an amount rounded to its currency, the arrival time told in the browser's timezone rather than the
 * profile's, and a card with no heading for an account whose link isn't known
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankReviewItem } from '@/api/bank-sync'
import type { Currency } from '@/api/currency'
import { formatMovedCurrency } from '@/utils/formatCurrency'

const MINUS = String.fromCodePoint(0x2212)
const CURRENCIES: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({
    formatMovedCurrency: (amount: number, currency: string) => formatMovedCurrency(amount, currency, CURRENCIES),
  }),
}))

import BankFilingCard from '@/components/transactions/transaction-modal/controls/BankFilingCard'

const LINK = { institution_name: 'Example Bank', external_account_name: 'Chequing' }

// A new item for $12.50 out on Sep 21. It arrived late that evening in Phoenix, already Sep 22 in UTC
const ITEM: BankReviewItem = {
  id: 'countdown',
  kind: 'new',
  account_id: 'everyday',
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  received_at: '2026-09-22T03:04:00Z',
  version: 1,
  bank: { date: '2026-09-21', amount: -1250, raw_amount: null, description: 'COUNTDOWN 123' },
  transaction_id: null,
  current: null,
  changed_fields: [],
  protected_fields: [],
}

function renderCard(item: BankReviewItem, isLinkKnown = true): string {
  return renderToStaticMarkup(
    createElement(BankFilingCard, {
      item,
      link: isLinkKnown ? LINK : undefined,
      accountName: 'Everyday',
      currency: 'USD',
      timeZone: 'America/Phoenix',
    }),
  )
}

function withBank(bank: Partial<BankReviewItem['bank']>): BankReviewItem {
  return { ...ITEM, bank: { ...ITEM.bank, ...bank } }
}

/** The card's text in reading order, one entry for each run of text between tags */
function textOf(markup: string): string[] {
  return markup.split(/<[^>]+>/).filter(Boolean)
}

/** Each labelled line of the card as [label, value], in order, with the value's markup taken out */
function fieldsOf(markup: string): [string, string][] {
  return [...markup.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)].map(([, label, value]) => [
    label,
    value.replace(/<[^>]+>/g, ''),
  ])
}

describe('the filing card', () => {
  it('carries the provider on its tab and names the institution, the bank account and the kind', () => {
    const markup = renderCard(ITEM)

    expect(markup).toContain('aria-label="SimpleFIN filing card"')
    expect(textOf(markup).slice(0, 6)).toEqual([
      'SimpleFIN',
      'Example Bank',
      'New',
      'Chequing',
      'Description from ',
      'SimpleFIN',
    ])
  })

  it('gives the description its own heading and lists the amount, date and when it was received', () => {
    const markup = renderCard(
      withBank({
        amount: -4210,
        description: 'COUNTDOWN 123 AUCKLAND',
      }),
    )

    expect(markup).toMatch(
      />Description from <span class="normal-case">SimpleFIN<\/span><\/p><p[^>]*>COUNTDOWN 123 AUCKLAND<\/p>/,
    )
    expect(fieldsOf(markup)).toEqual([
      ['Amount', `${MINUS}$42.10`],
      ['Date', 'Sep 21, 2026'],
      ['Received', expect.stringMatching(/^Sep 21, 8:04\sp\.m\.$/u)],
    ])
  })

  it('shows an amount its currency cannot hold exactly as the bank sent it', () => {
    const fields = new Map(fieldsOf(renderCard(withBank({ amount: null, raw_amount: '-42.105' }))))

    expect(fields.get('Amount')).toBe(`${MINUS}$42.105`)
  })

  it('is headed by the account in the app when its link is not known', () => {
    expect(textOf(renderCard(ITEM, false)).slice(0, 5)).toEqual([
      'SimpleFIN',
      'Everyday',
      'New',
      'Description from ',
      'SimpleFIN',
    ])
  })
})
