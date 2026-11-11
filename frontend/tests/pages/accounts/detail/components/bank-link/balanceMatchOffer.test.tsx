/**
 * Covers the balance match offer at the foot of the balance panel: its title and sentences, the offered
 * amount shown as a figure with its sign and an info icon saying how it is worked out, and Record
 * adjustment as its only control
 *
 * These tests catch a Skip coming back, the sentence giving the adjustment's date as the server sends
 * it, the items waiting for review left unmentioned or mentioned while none move the balance, the
 * sentences growing back, a field to change the amount coming back, the amount shown without its sign, a card's negative offer shown as positive, and a
 * currency without cents shown in cents. Recording and a refused recording run in the browser
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BalanceMatch } from '@/api/bank-sync'
import type { Currency } from '@/api/currency'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

// The crossfade needs a browser to mount, so a button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))
vi.mock('@/hooks/useMoneyFormatters', async () => {
  const { formatCurrency, formatMovedCurrency } =
    await vi.importActual<typeof import('@/utils/formatCurrency')>('@/utils/formatCurrency')
  return {
    useMoneyFormatters: () => ({
      currencies: CURRENCIES,
      formatCurrency: (minorUnits: number, currency: string) => formatCurrency(minorUnits, currency, CURRENCIES),
      formatMovedCurrency: (minorUnits: number, currency: string) =>
        formatMovedCurrency(minorUnits, currency, CURRENCIES),
    }),
  }
})
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useRecordBalanceMatch: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

import { BalanceMatchOffer } from '@/pages/accounts/detail/components/bank-link/BalanceMatchOffer'
import { formatMovedCurrency } from '@/utils/formatCurrency'

/** Static rendering marks where one text node meets the next and escapes apostrophes */
function renderOffer(offer: BalanceMatch, currency = 'CAD'): string {
  return renderToStaticMarkup(
    <BalanceMatchOffer
      accountId="account-1"
      offer={offer}
      currency={currency}
      providerName="SimpleFIN"
      onFolded={vi.fn()}
    />,
  )
    .replaceAll('<!-- -->', '')
    .replaceAll('&#x27;', "'")
}

/** The text of the offer's paragraphs above the amount: its title, then its sentences */
function readParagraphs(markup: string): string[] {
  return [...markup.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((match) => match[1])
}

/** The text of the offer's sentences, under its title */
function readSentences(markup: string): string {
  return readParagraphs(markup)[1] ?? ''
}

/** The amount's label as read, its info icon's name, and the figure shown under it */
function readAmount(markup: string): [string, string, string] {
  const term = markup.match(/<dt[^>]*>(.*?)<\/dt>/s)?.[1] ?? ''
  const label = term.match(/^([^<]*)/)?.[1] ?? ''
  const hint = term.match(/aria-label="([^"]*)"/)?.[1] ?? ''
  const value = markup.match(/<dd[^>]*>([^<]*)<\/dd>/)?.[1] ?? ''
  return [label, hint, value]
}

describe('the balance match offer', () => {
  it("offers to match SimpleFIN's balance with an adjustment on the day before the import start, with Record adjustment and no Skip", () => {
    const markup = renderOffer({ amount: 25000, waiting_amount: 0, adjustment_date: '2026-05-31' })

    expect(readParagraphs(markup)[0]).toBe("Match SimpleFIN's balance")
    expect(readSentences(markup)).toBe('Adds a balance adjustment on May 31, 2026.')
    // The other button is the amount's info icon
    expect(markup.match(/<button/g)).toHaveLength(2)
    expect(markup).toContain('>Record adjustment<')
    expect(markup).not.toContain('Skip')
  })

  it.each([
    { waiting: 0, sentences: 'Adds a balance adjustment on May 31, 2026.' },
    {
      waiting: -1350,
      sentences:
        'Adds a balance adjustment on May 31, 2026. If you entered any waiting items by hand, please review those items first.',
    },
    {
      waiting: 2000,
      sentences:
        'Adds a balance adjustment on May 31, 2026. If you entered any waiting items by hand, please review those items first.',
    },
  ])(
    'asks for the waiting items to be reviewed first only while $waiting waits for review',
    ({ waiting, sentences }) => {
      expect(
        readSentences(renderOffer({ amount: 25000, waiting_amount: waiting, adjustment_date: '2026-05-31' })),
      ).toBe(sentences)
    },
  )

  it.each([
    { amount: 25000, currency: 'CAD', sign: '+' },
    { amount: -2000, currency: 'CAD', sign: String.fromCodePoint(0x2212) },
    { amount: -3000, currency: 'JPY', sign: String.fromCodePoint(0x2212) },
  ])(
    'shows the offered $amount in $currency as a figure with its sign, how it is worked out, and no field to change it',
    ({ amount, currency, sign }) => {
      const markup = renderOffer({ amount, waiting_amount: 0, adjustment_date: '2026-05-31' }, currency)
      const [label, hint, value] = readAmount(markup)

      expect(label).toBe('Adjustment')
      expect(hint).toBe('How the adjustment is worked out')
      expect(value).toBe(formatMovedCurrency(amount, currency, CURRENCIES))
      expect(value.startsWith(sign)).toBe(true)
      expect(markup).not.toContain('<input')
    },
  )
})
