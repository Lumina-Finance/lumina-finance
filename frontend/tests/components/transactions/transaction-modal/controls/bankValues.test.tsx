/**
 * Guards what the transaction modal shows of a bank-imported transaction: the provider and the bank's
 * description, read-only, and under an edited field the bank's value with an action to restore it.
 * The action says when it is restoring and names the value it restores, or shows greyed out with its
 * reason for a value the ledger can't store, and under it a restore that failed. Which fields are
 * edited is covered with the captions' values. Where each caption sits, when the action is turned off,
 * pressing it, focus after it, and the reason showing beside it, are covered end to end, since the
 * details section's date field needs a page to render into
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useMoneyFormatters', () => ({
  useMoneyFormatters: () => ({ formatMovedCurrency: (amount: number) => `CA$${(amount / 100).toFixed(2)}` }),
}))

import TransactionBankSourcePanel from '@/components/transactions/transaction-modal/controls/BankSourcePanel'
import TransactionBankValueCaption from '@/components/transactions/transaction-modal/controls/BankValueCaption'

const MINUS = String.fromCodePoint(0x2212)
const UNSTORABLE_REASON = "The bank's amount has more decimal places than CAD allows, so it can't be restored."

// Static rendering escapes the apostrophes in the reason, so markup is matched against the escaped text
const RENDERED_UNSTORABLE_REASON = UNSTORABLE_REASON.replaceAll("'", '&#x27;')

function renderCaption(overrides: Partial<Parameters<typeof TransactionBankValueCaption>[0]> = {}): string {
  return renderToStaticMarkup(
    <TransactionBankValueCaption
      id="txn-amount-bank-value"
      actionId="txn-amount-restore"
      bankValue={`${MINUS}CA$42.10`}
      financial
      unavailableReason={null}
      error={null}
      restoring={false}
      disabled={false}
      onRestore={() => {}}
      {...overrides}
    />,
  )
}

/** The opening tag, name and visible text of the caption's one button */
function restoreButton(markup: string): { tag: string; name: string; inner: string; text: string } {
  const [, tag, inner] = markup.match(/(<button[^>]*>)(.*?)<\/button>/) ?? []
  return { tag, name: tag?.match(/aria-label="([^"]*)"/)?.[1] ?? '', inner, text: inner?.replace(/<[^>]*>/g, '') }
}

describe('bank source panel', () => {
  const panel = (defaultOpen: boolean) =>
    renderToStaticMarkup(
      <TransactionBankSourcePanel
        providerName="SimpleFIN"
        bankValues={{ date: '2026-10-04', amount: -1250, raw_amount: null, description: 'HARBOUR CAFE #12 VANCOUVER' }}
        receivedAt="2026-10-05T06:30:00Z"
        timeZone="America/Vancouver"
        heading="Harbour Bank"
        bankAccountName="Everyday Chequing"
        currency="CAD"
        defaultOpen={defaultOpen}
      />,
    )

  it('starts closed to the provider line alone, with a toggle that says so', () => {
    const markup = panel(false)

    expect(markup).toContain('From <span class="normal-case">SimpleFIN</span>')
    expect(markup).toMatch(/aria-expanded="false"/)
    expect(markup).not.toContain('HARBOUR CAFE')
    expect(markup).not.toContain('filing card')
  })

  it('opens to the provider filing card of what the bank sent, with nothing to edit it', () => {
    const markup = panel(true)

    expect(markup).toMatch(/aria-expanded="true"/)
    expect(markup).toContain('SimpleFIN filing card')
    expect(markup).toContain('Harbour Bank')
    expect(markup).toContain('Everyday Chequing')
    expect(markup).toMatch(/HARBOUR CAFE #12 VANCOUVER/)
    expect(markup).toContain('Description from <span class="normal-case">SimpleFIN</span>')

    // Told in the user's timezone, so 6:30 in the morning of the 5th in UTC is 11:30 at night on the 4th in Vancouver
    expect(markup).toMatch(/Received<\/dt><dd[^>]*>Oct 4,? .*11:30/)
    expect(markup).not.toMatch(/<(input|textarea)\b/)
  })

  it("is the filing card shrunk to its top edge when closed, in the card tab's own colour and type", () => {
    const closed = panel(false)
    const button = /<button[^>]*>/.exec(closed)?.[0] ?? ''

    expect(button).toContain('background:var(--app-filing-card)')
    expect(button).toContain('tracking-[0.2em]')
    expect(button).toContain('w-full')
    expect(button).toContain('rounded-b-md')
    expect(closed).not.toContain('app-filing-card ')
  })

  it("keeps the strip as the open card's tab, joined to the card with its top corners square", () => {
    const open = panel(true)
    const button = /<button[^>]*>/.exec(open)?.[0] ?? ''

    expect(button).toContain('background:var(--app-filing-card)')
    expect(button).not.toContain('rounded-b-md')
    expect(open).toMatch(/class="app-filing-card relative font-mono text-sm leading-7 rounded-b-md"/)
  })

  it('shows the filing card alone, in no panel of its own and without a tab repeating the heading', () => {
    const markup = panel(true)

    expect(markup).not.toContain('app-card')
    expect(markup.match(/class="app-filing-card /g)).toHaveLength(1)
    expect(markup.match(/<span class="inline-block[^>]*>SimpleFIN</g) ?? []).toHaveLength(0)
  })
})

describe('bank value caption', () => {
  it('shows the bank value in the figures typeface with a restore icon after it, described by that value', () => {
    const markup = renderCaption()

    expect(markup).toContain(
      `<span id="txn-amount-bank-value">Bank: <span class="font-financial">${MINUS}CA$42.10</span></span>`,
    )
    const { tag, name, inner, text } = restoreButton(markup)
    expect(markup.indexOf('id="txn-amount-bank-value"')).toBeLessThan(markup.indexOf('<button'))
    expect(name).toBe('Restore bank value')
    expect(text).toBe('')
    expect(inner).toContain('lucide-rotate-ccw')
    expect(tag).toContain('aria-describedby="txn-amount-bank-value"')
    expect(tag).toContain('aria-busy="false"')
    expect(tag).not.toContain('disabled=""')
    expect(tag).not.toContain('aria-disabled="')
    expect(markup).not.toContain('role="alert"')
  })

  it('says a restore failed under the bank value, as an alert, leaving the action to try again', () => {
    const markup = renderCaption({ error: 'Could not restore the bank value. Please try again.' })

    expect(markup).toMatch(/<\/p><p role="alert"[^>]*>Could not restore the bank value\. Please try again\.<\/p>/)
    const { tag, name } = restoreButton(markup)
    expect(name).toBe('Restore bank value')
    expect(tag).toContain('id="txn-amount-restore"')
    expect(tag).not.toContain('disabled=""')
  })

  it('says it is restoring, busy and closed to a second press', () => {
    const { tag, name, inner } = restoreButton(renderCaption({ restoring: true }))

    expect(name).toBe('Restoring')
    expect(inner).toContain('animate-spin')
    expect(tag).toContain('aria-busy="true"')
    expect(tag).toContain('disabled=""')
  })

  it("greys out the action for a bank value the ledger can't store, still focusable and described by why", () => {
    const markup = renderCaption({ bankValue: `${MINUS}CA$42.505`, unavailableReason: UNSTORABLE_REASON })

    expect(markup).toContain(`Bank: <span class="font-financial">${MINUS}CA$42.505</span>`)
    const { tag, name } = restoreButton(markup)
    expect(name).toBe('Restore bank value')
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).not.toContain('disabled=""')

    // Described by the bank's value, then by the reason it can't be restored
    const [valueId, reasonId] = tag.match(/aria-describedby="([^"]*)"/)?.[1].split(' ') ?? []
    expect(valueId).toBe('txn-amount-bank-value')
    expect(markup).toContain(`<span id="${reasonId}" hidden="">${RENDERED_UNSTORABLE_REASON}</span>`)

    // Only the icon fades, so the focus ring around the action keeps its full strength
    expect(restoreButton(markup).inner).toMatch(/<svg[^>]*class="[^"]*opacity-60/)
    expect(tag).not.toMatch(/(^|\s)opacity-/)
  })
})
