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

// A new item for $12.50 out on Sep 21, which arrived late that evening in Phoenix, already Sep 22 in UTC
const ITEM: BankReviewItem = {
  id: 'countdown',
  kind: 'new',
  account_id: 'everyday',
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  external_transaction_id: 'TRN-8841',
  received_at: '2026-09-22T03:04:00Z',
  version: 1,
  bank: { date: '2026-09-21', amount: -1250, raw_amount: null, description: 'COUNTDOWN 123', merchant_name: null, category_hint: null },
  transaction_id: null,
  current: null,
  changed_fields: [],
  protected_fields: [],
}

function renderCard(item: BankReviewItem, isLinkKnown = true): string {
  return renderToStaticMarkup(createElement(BankFilingCard, {
    item,
    link: isLinkKnown ? LINK : undefined,
    accountName: 'Everyday',
    currency: 'USD',
    timeZone: 'America/Phoenix',
  }))
}

function withBank(bank: Partial<BankReviewItem['bank']>): BankReviewItem {
  return { ...ITEM, bank: { ...ITEM.bank, ...bank } }
}

/** Each labelled line of the card as [label, value], in order, with the value's markup taken out */
function fieldsOf(markup: string): [string, string][] {
  return [...markup.matchAll(/<dt[^>]*>(.*?)<\/dt><dd[^>]*>(.*?)<\/dd>/g)]
    .map(([, label, value]) => [label, value.replace(/<[^>]+>/g, '')])
}

describe('the filing card', () => {
  it('carries the provider on its tab and names the institution, the bank account and the kind', () => {
    const markup = renderCard(ITEM)

    expect(markup).toMatch(/^<div[^>]*><span[^>]*>SimpleFIN<\/span><div role="region" aria-label="SimpleFIN filing card"/)
    expect(markup).toMatch(/>Example Bank<\/p><p[^>]*>New<\/p><\/div><p[^>]*>Chequing<\/p>/)
  })

  it('gives the description its own heading and lists every other field the provider sent', () => {
    const markup = renderCard(withBank({
      amount: -4210,
      description: 'COUNTDOWN 123 AUCKLAND',
      merchant_name: 'Countdown',
      category_hint: 'Groceries',
    }))

    expect(markup).toMatch(/>Description from SimpleFIN<\/p><p[^>]*>COUNTDOWN 123 AUCKLAND<\/p>/)
    expect(fieldsOf(markup)).toEqual([
      ['Amount', `${MINUS}$42.10`],
      ['Date', 'Sep 21, 2026'],
      ['Merchant', 'Countdown'],
      ['Category', 'Groceries'],
      ['Received', expect.stringMatching(/^Sep 21, 8:04\sp\.m\.$/u)],
      ['Ref', 'TRN-8841'],
    ])
  })

  it('shows "—" for a merchant or category the provider did not send', () => {
    const fields = new Map(fieldsOf(renderCard(withBank({ merchant_name: null, category_hint: null }))))

    expect(fields.get('Merchant')).toBe('—')
    expect(fields.get('Category')).toBe('—')
  })

  it('shows an amount its currency cannot hold exactly as the bank sent it', () => {
    const fields = new Map(fieldsOf(renderCard(withBank({ amount: null, raw_amount: '-42.105' }))))

    expect(fields.get('Amount')).toBe(`${MINUS}$42.105`)
  })

  it('is headed by the account in the app when its link is not known', () => {
    const markup = renderCard(ITEM, false)

    expect(markup).toMatch(/>Everyday<\/p><p[^>]*>New<\/p><\/div><\/div>/)
    expect(markup).not.toContain('Chequing')
  })
})
