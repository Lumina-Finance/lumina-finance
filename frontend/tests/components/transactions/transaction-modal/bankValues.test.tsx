/**
 * Guards what the transaction modal shows of a bank-imported transaction: the provider and the bank's
 * description, read-only, and under an edited field the bank's value with an action to restore it,
 * which says when it is restoring, can be turned off and names the value it restores. Which fields
 * are edited is covered with the captions' values. Where each caption sits, and pressing the action,
 * are covered end to end, since the details section's date field needs a page to render into
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TransactionBankSourcePanel from '@/components/transactions/transaction-modal/controls/BankSourcePanel'
import TransactionBankValueCaption from '@/components/transactions/transaction-modal/controls/BankValueCaption'

const MINUS = String.fromCodePoint(0x2212)

function renderCaption(overrides: Partial<Parameters<typeof TransactionBankValueCaption>[0]> = {}): string {
  return renderToStaticMarkup(
    <TransactionBankValueCaption
      id="txn-amount-bank-value"
      bankValue={`${MINUS}CA$42.10`}
      financial
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
    expect(markup).toContain('<dt class="text-xs font-medium" style="color:var(--app-text-muted)">Bank description</dt>')
    expect(markup).toMatch(/<dd[^>]*>HARBOUR CAFE #12 VANCOUVER<\/dd>/)
    expect(markup).not.toMatch(/<(input|textarea|button)\b/)
  })
})

describe('bank value caption', () => {
  it('shows the bank value in the figures typeface with an action to restore it, described by that value', () => {
    const markup = renderCaption()

    expect(markup).toContain(`<span id="txn-amount-bank-value">Bank: <span class="font-financial">${MINUS}CA$42.10</span></span>`)
    const { tag, text } = restoreButton(markup)
    expect(text).toBe('Restore bank value')
    expect(tag).toContain('aria-describedby="txn-amount-bank-value"')
    expect(tag).toContain('aria-busy="false"')
    expect(tag).not.toContain('disabled=""')
  })

  it('shows a date in the interface typeface', () => {
    expect(renderCaption({ id: 'txn-date-bank-value', bankValue: 'Oct 3, 2026', financial: false }))
      .toContain('<span id="txn-date-bank-value">Bank: <span>Oct 3, 2026</span></span>')
  })

  it('says it is restoring, busy and closed to a second press, without fading', () => {
    const { tag, text } = restoreButton(renderCaption({ restoring: true }))

    expect(text).toBe('Restoring')
    expect(tag).toContain('aria-busy="true"')
    expect(tag).toContain('disabled=""')
    expect(tag).not.toContain('disabled:opacity-60')
  })

  it('turns the action off while the modal is busy or read-only, faded as unavailable', () => {
    const { tag, text } = restoreButton(renderCaption({ disabled: true }))

    expect(text).toBe('Restore bank value')
    expect(tag).toContain('disabled=""')
    expect(tag).toContain('disabled:opacity-60')
  })

  it('shows nothing under a field that matches the bank', () => {
    expect(renderCaption({ bankValue: null })).toBe('')
  })
})
