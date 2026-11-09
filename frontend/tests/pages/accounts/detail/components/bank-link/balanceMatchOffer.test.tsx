/**
 * Covers the balance match offer at the foot of the balance panel: its title and sentences, the offered
 * amount it starts from with the offer's sign beside it, Record adjustment as its only button, the
 * amount a recording sends, the typing an offer of another amount replaces, and the signs the amount
 * refuses
 *
 * These tests catch a Skip coming back, the sentence asking for the adjustment with its date given as
 * the server sends it or with the wrong provider, the ledger's balance said to move the wrong way, the items waiting
 * for review left unmentioned, said to move it the wrong way, by the wrong amount, with a doubled
 * sign or in the wrong currency, or mentioned while they move nothing, the field starting blank,
 * signed in the field, or with no sign beside it, a sign a screen reader never hears or hears the
 * wrong way round, a card's negative offer shown as positive, a currency without cents shown in
 * cents, an amount shown or recordable while the currency's decimal places are unknown, a message
 * shown before anything is recorded, an amount typed over the offer recorded with the wrong sign, a
 * blank or zero amount sent rather than refused, typing kept over the remainder a recording leaves,
 * and a hyphen, true minus or plus taken without saying why. Recording, the messages for a zero amount
 * and a typed sign, and a refused recording run in the browser
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
  const { formatCurrency } = await vi.importActual<typeof import('@/utils/formatCurrency')>('@/utils/formatCurrency')
  return {
    useMoneyFormatters: () => ({
      currencies: CURRENCIES,
      formatCurrency: (minorUnits: number, currency: string) => formatCurrency(minorUnits, currency, CURRENCIES),
    }),
  }
})
vi.mock('@/hooks/useCurrencyListState', () => ({ useCurrencyListState: () => 'ready' }))
vi.mock('@/components/currency/CurrencyUnavailableTooltip', () => ({
  CurrencyUnavailableTooltip: ({ unavailable, label }: { unavailable: boolean; label: string }) =>
    unavailable ? label : null,
}))
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/api/bank-sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bank-sync')>()),
  useRecordBalanceMatch: () => ({ isPending: false, mutateAsync: vi.fn() }),
}))

import { BalanceMatchOffer } from '@/pages/accounts/detail/components/bank-link/BalanceMatchOffer'
import { formatCurrencySymbol } from '@/utils/formatCurrency'
import {
  BLANK_AMOUNT_MESSAGE,
  getRecordingProblem,
  holdsSign,
  readRecordedAmount,
  readRecording,
  readTypedAmount,
  SIGNED_AMOUNT_MESSAGE,
  ZERO_AMOUNT_MESSAGE,
} from '@/pages/accounts/detail/components/bank-link/balanceMatch'

const MINUS = String.fromCodePoint(0x2212)

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

/** The sign and symbol shown beside the field, and the field's value */
function readField(markup: string): [string, string] {
  const prefix = markup.match(/<span[^>]*aria-hidden="true"[^>]*>([^<]*)<\/span><input/)?.[1] ?? ''
  const value = markup.match(/<input[^>]*value="([^"]*)"/)?.[1] ?? ''
  return [prefix, value]
}

/** The field's description, the text of the element its aria-describedby names */
function readDescription(markup: string): string {
  const id = markup.match(/<input[^>]*aria-describedby="([^"]*)"/)?.[1]
  if (!id) return ''
  return markup.match(new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)<`))?.[1] ?? ''
}

/** The attributes of the input, or of the button holding this label */
function readAttributes(markup: string, label?: string): string {
  const pattern = label ? new RegExp(`<button([^>]*)>(?:(?!</button>).)*${label}`, 's') : /<input([^>]*)>/
  return markup.match(pattern)?.[1] ?? ''
}

describe('the balance match offer', () => {
  it("offers to match SimpleFIN's balance with an adjustment on the day before the import start, with Record adjustment and no Skip", () => {
    const markup = renderOffer({ amount: 25000, waiting_amount: 0, adjustment_date: '2026-05-31' })

    expect(readParagraphs(markup)[0]).toBe("Match SimpleFIN's balance")
    expect(readSentences(markup)).toMatch(
      /^Record the difference as a balance adjustment on May 31, 2026, so your ledger matches SimpleFIN's balance\./,
    )
    expect(markup).toMatch(/<label[^>]*><span[^>]*>Adjustment amount<\/span><\/label>/)
    expect(markup.match(/<button/g)).toHaveLength(1)
    expect(markup).toContain('>Record adjustment<')
    expect(markup).not.toContain('Skip')
    expect(markup).not.toContain(BLANK_AMOUNT_MESSAGE)
  })

  it.each([
    { amount: 25000, waiting: 0, currency: 'CAD', direction: 'raises', note: null },
    { amount: -2000, waiting: 0, currency: 'CAD', direction: 'lowers', note: null },
    {
      amount: 26350,
      waiting: -1350,
      currency: 'CAD',
      direction: 'raises',
      note: "would lower your ledger's balance by CA$13.50",
    },
    {
      amount: 23000,
      waiting: 2000,
      currency: 'CAD',
      direction: 'raises',
      note: "would raise your ledger's balance by CA$20.00",
    },
    {
      amount: -3000,
      waiting: -450,
      currency: 'JPY',
      direction: 'lowers',
      note: "would lower your ledger's balance by ¥450",
    },
  ])(
    "says an offer of $amount in $currency $direction the ledger's balance, and what $waiting waiting for review would move it by",
    ({ amount, waiting, currency, direction, note }) => {
      const sentences = readSentences(
        renderOffer({ amount, waiting_amount: waiting, adjustment_date: '2026-05-31' }, currency),
      )

      expect(sentences.match(/This (raises|lowers) your ledger's balance\./g)).toEqual([
        `This ${direction} your ledger's balance.`,
      ])
      expect(sentences.match(/would (raise|lower) your ledger's balance by [^,]*/)?.[0] ?? null).toBe(note)
    },
  )

  it.each([
    {
      amount: 25000,
      currency: 'CAD',
      // The symbol the reader's own language writes, as the rest of the app shows it, not the table's
      shown: [`+${formatCurrencySymbol('CAD')}`, '250.00'],
      described: 'Your ledger records this amount as positive.',
    },
    {
      amount: -2000,
      currency: 'CAD',
      shown: [`${MINUS}${formatCurrencySymbol('CAD')}`, '20.00'],
      described: 'Your ledger records this amount as negative.',
    },
    {
      amount: -3000,
      currency: 'JPY',
      shown: [`${MINUS}${formatCurrencySymbol('JPY')}`, '3000'],
      described: 'Your ledger records this amount as negative.',
    },
  ])(
    'starts from the offered $amount in $currency, its size in the field and its sign beside it and in its description',
    ({ amount, currency, shown, described }) => {
      const markup = renderOffer({ amount, waiting_amount: 0, adjustment_date: '2026-05-31' }, currency)

      expect(readField(markup)).toEqual(shown)
      expect(readDescription(markup)).toBe(described)
    },
  )

  it.each(['CAD', 'JPY'])(
    'clears the sign and the %s symbol with the money fields helper, not a character count',
    (currency) => {
      const markup = renderOffer({ amount: -2000, waiting_amount: 0, adjustment_date: '2026-05-31' }, currency)
      const attributes = readAttributes(markup)

      expect(attributes).toMatch(/class="[^"]*\bpl-8\b/)
      expect(attributes).toMatch(/style="padding-left:/)
      expect(attributes).not.toContain('1.5rem')
    },
  )

  it("locks the amount and Record adjustment, showing no amount, while the currency's decimal places are unknown", () => {
    const markup = renderOffer({ amount: -3000, waiting_amount: 0, adjustment_date: '2026-05-31' }, 'XYZ')

    expect(readField(markup)).toEqual([MINUS, ''])
    expect(readAttributes(markup)).toContain('disabled=""')
    expect(readAttributes(markup, 'Record adjustment')).toContain('aria-disabled="true"')
    expect(markup).toContain('Adjustment amount unavailable')
  })
})

describe('what the amount shows of what was typed', () => {
  it('keeps 240.00 typed over an offer of 250.00 while that offer stands', () => {
    expect(readTypedAmount({ offered: 25000, value: '240.00' }, 25000)).toBe('240.00')
  })

  it('shows the offered amount once the offer moves, such as to the 10.00 a recording of 240.00 leaves', () => {
    expect(readTypedAmount({ offered: 25000, value: '240.00' }, 1000)).toBeNull()
    expect(readTypedAmount(null, 1000)).toBeNull()
  })
})

describe('the amount a recording sends', () => {
  it.each([
    { typed: '250.00', exponent: 2, offered: 25000, recorded: 25000 },
    { typed: '240', exponent: 2, offered: 25000, recorded: 24000 },
    { typed: '20.00', exponent: 2, offered: -2000, recorded: -2000 },
    { typed: '25.5', exponent: 2, offered: -2000, recorded: -2550 },
    { typed: '2500', exponent: 0, offered: -3000, recorded: -2500 },
  ])(
    'records $typed against an offer of $offered with $exponent decimal places as $recorded',
    ({ typed, exponent, offered, recorded }) => {
      expect(readRecordedAmount(typed, exponent, offered)).toBe(recorded)
    },
  )

  it.each(['', '0', '0.00'])('records nothing for %j', (typed) => {
    expect(readRecordedAmount(typed, 2, 25000)).toBeNull()
  })
})

describe('the problem a refused press of Record adjustment keeps marked', () => {
  it('says a blank amount is missing and a typed zero is zero, so typing a zero keeps the mark', () => {
    expect(getRecordingProblem(null, '', 2, 25000)).toBe(BLANK_AMOUNT_MESSAGE)
    expect(getRecordingProblem(null, ' ', 2, 25000)).toBe(BLANK_AMOUNT_MESSAGE)
    expect(getRecordingProblem(null, '0', 2, 25000)).toBe(ZERO_AMOUNT_MESSAGE)
  })

  it('names the sign while its message shows, and nothing once the amount is whole', () => {
    expect(getRecordingProblem(SIGNED_AMOUNT_MESSAGE, '250.00', 2, 25000)).toBe(SIGNED_AMOUNT_MESSAGE)
    expect(getRecordingProblem(null, '5', 2, 25000)).toBeUndefined()
  })
})

describe('what a press of Record adjustment reads', () => {
  it('refuses while the sign message shows, instead of recording the amount the field kept', () => {
    expect(readRecording(SIGNED_AMOUNT_MESSAGE, '250.00', 2, 25000)).toEqual({ refusal: SIGNED_AMOUNT_MESSAGE })
  })

  it('refuses a blank or zero amount, each with its own message', () => {
    expect(readRecording(null, '', 2, 25000)).toEqual({ refusal: BLANK_AMOUNT_MESSAGE })
    expect(readRecording(null, '0.00', 2, 25000)).toEqual({ refusal: ZERO_AMOUNT_MESSAGE })
  })

  it("records the amount with the offer's sign once no message shows", () => {
    expect(readRecording(null, '20.00', 2, -2000)).toEqual({ amount: -2000 })
  })
})

describe('the signs the amount refuses', () => {
  it.each([
    { typed: '-240.00', signed: true },
    { typed: `${MINUS}240.00`, signed: true },
    { typed: '+240.00', signed: true },
    { typed: '240.00', signed: false },
  ])('reads $typed as signed: $signed', ({ typed, signed }) => {
    expect(holdsSign(typed)).toBe(signed)
  })
})
