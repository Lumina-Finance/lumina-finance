/**
 * Guards the bank review dialogue's footer. Add to ledger is the form's submit, so it announces the
 * submit shortcut and carries the key cap shown while the action key is held, as every dialogue's
 * submit does, and Dismiss does not. The keep open choice is main's native checkbox, named by both lines
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TransactionReviewFooter from '@/components/transactions/transaction-modal/layout/ReviewFooter'
import { ARIA_SUBMIT_SHORTCUT } from '@/components/transactions/transaction-modal/utils/shortcuts'

afterEach(() => vi.unstubAllGlobals())

function render(): string {
  // The buttons' label crossfade asks the window whether motion is reduced
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
  return renderToStaticMarkup(
    <TransactionReviewFooter
      isPending={false}
      submitLoading={false}
      dismissLoading={false}
      keepOpen={false}
      onKeepOpenChange={() => {}}
      onDismiss={() => {}}
    />,
  )
}

describe('the bank review footer', () => {
  it('announces the submit shortcut on Add to ledger only, and draws its key cap', () => {
    const markup = render()
    const submit = markup.match(/<button\b[^>]*data-testid="transaction-submit"[^>]*>/)?.[0]
    const dismiss = markup.match(/<button\b[^>]*aria-label="Dismiss"[^>]*>/)?.[0]

    expect(submit).toContain(`aria-keyshortcuts="${ARIA_SUBMIT_SHORTCUT}"`)
    expect(dismiss).not.toContain('aria-keyshortcuts')
    expect(markup).toContain('app-shortcut-hints-save')
  })

  it('draws the keep open choice as main does, a native checkbox inside a label holding its hint', () => {
    const markup = render()
    const label = markup.match(/<label\b[^>]*\bfor="([^"]*)"[^>]*>(.*?)<\/label>/)

    expect(label?.[2]).toMatch(new RegExp(`<input\\b[^>]*\\bid="${label?.[1]}"[^>]*\\btype="checkbox"`))
    expect(
      label?.[2]
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ).toBe('Keep window open Review one item after another')
  })
})
