/**
 * Guards what the transaction modal shows of a bank-imported transaction: the provider and the bank's
 * description, read-only, and under an edited field the bank's value with an action to restore it,
 * which says when it is restoring and names the value it restores, or no action for a value the
 * ledger can't store. Which fields are edited is covered with the captions' values. Where each
 * caption sits, when the action is turned off, and pressing it, are covered end to end, since the
 * details section's date field needs a page to render into
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
      restorable
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

    expect(markup).toContain(`<span id="txn-amount-bank-value">Bank: <span class="font-financial">${MINUS}CA$42.10</span></span>`)
    const { tag, text } = restoreButton(markup)
    expect(text).toBe('Restore bank value')
    expect(tag).toContain('aria-describedby="txn-amount-bank-value"')
    expect(tag).toContain('aria-busy="false"')
    expect(tag).not.toContain('disabled=""')
  })

  it('says it is restoring, busy and closed to a second press', () => {
    const { tag, text } = restoreButton(renderCaption({ restoring: true }))

    expect(text).toBe('Restoring')
    expect(tag).toContain('aria-busy="true"')
    expect(tag).toContain('disabled=""')
  })

  it('shows a bank value the ledger can\'t store with no action to restore it', () => {
    const markup = renderCaption({ bankValue: `${MINUS}CA$42.505`, restorable: false })

    expect(markup).toContain(`Bank: <span class="font-financial">${MINUS}CA$42.505</span>`)
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('·')
  })
})
