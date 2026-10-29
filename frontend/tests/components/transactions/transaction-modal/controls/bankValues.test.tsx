/**
 * Guards what the transaction modal shows of a bank-imported transaction: the provider and the bank's
 * description, read-only, and under an edited field the bank's value with an action to restore it,
 * which says when it is restoring and names the value it restores, or shows greyed out with its
 * reason for a value the ledger can't store, and under it a restore that failed. Which fields are
 * edited is covered with the captions' values. Where each caption sits, when the action is turned off,
 * pressing it, focus after it, and the reason showing beside it, are covered end to end, since the
 * details section's date field needs a page to render into
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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

/** The opening tag and text of the caption's one button */
function restoreButton(markup: string): { tag: string; text: string } {
  const [, tag, inner] = markup.match(/(<button[^>]*>)(.*?)<\/button>/) ?? []
  return { tag, text: inner?.replace(/<[^>]*>/g, '') }
}

describe('bank source panel', () => {
  it('names the provider and shows the bank description as text, with nothing to edit it', () => {
    const markup = renderToStaticMarkup(
      <TransactionBankSourcePanel providerName="SimpleFIN" description="HARBOUR CAFE #12 VANCOUVER" />,
    )

    expect(markup).toContain('From SimpleFIN')
    expect(markup).toMatch(/<dt[^>]*>Bank description<\/dt>/)
    expect(markup).toMatch(/<dd[^>]*>HARBOUR CAFE #12 VANCOUVER<\/dd>/)
    expect(markup).not.toMatch(/<(input|textarea|button)\b/)
  })
})

describe('bank value caption', () => {
  it('shows the bank value in the figures typeface with an action to restore it, described by that value', () => {
    const markup = renderCaption()

    expect(markup).toContain(
      `<span id="txn-amount-bank-value">Bank: <span class="font-financial">${MINUS}CA$42.10</span></span>`,
    )
    const { tag, text } = restoreButton(markup)
    expect(text).toBe('Restore bank value')
    expect(tag).toContain('aria-describedby="txn-amount-bank-value"')
    expect(tag).toContain('aria-busy="false"')
    expect(tag).not.toContain('disabled=""')
    expect(tag).not.toContain('aria-disabled="')
    expect(markup).not.toContain('role="alert"')
  })

  it('says a restore failed under the bank value, as an alert, leaving the action to try again', () => {
    const markup = renderCaption({ error: 'Could not restore the bank value. Please try again.' })

    expect(markup).toMatch(/<\/p><p role="alert"[^>]*>Could not restore the bank value\. Please try again\.<\/p>/)
    const { tag, text } = restoreButton(markup)
    expect(text).toBe('Restore bank value')
    expect(tag).toContain('id="txn-amount-restore"')
    expect(tag).not.toContain('disabled=""')
  })

  it('says it is restoring, busy and closed to a second press', () => {
    const { tag, text } = restoreButton(renderCaption({ restoring: true }))

    expect(text).toBe('Restoring')
    expect(tag).toContain('aria-busy="true"')
    expect(tag).toContain('disabled=""')
  })

  it("greys out the action for a bank value the ledger can't store, still focusable and described by why", () => {
    const markup = renderCaption({ bankValue: `${MINUS}CA$42.505`, unavailableReason: UNSTORABLE_REASON })

    expect(markup).toContain(`Bank: <span class="font-financial">${MINUS}CA$42.505</span>`)
    const { tag, text } = restoreButton(markup)
    expect(text).toBe('Restore bank value')
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).not.toContain('disabled=""')

    // Described by the bank's value, then by the reason it can't be restored
    const [valueId, reasonId] = tag.match(/aria-describedby="([^"]*)"/)?.[1].split(' ') ?? []
    expect(valueId).toBe('txn-amount-bank-value')
    expect(markup).toContain(`<span id="${reasonId}" hidden="">${RENDERED_UNSTORABLE_REASON}</span>`)

    // Only the label fades, so the focus ring around the action keeps its full strength
    expect(markup).toContain('<span class="underline underline-offset-2 opacity-60">Restore bank value</span>')
    expect(tag).not.toMatch(/(^|\s)opacity-/)
  })
})
