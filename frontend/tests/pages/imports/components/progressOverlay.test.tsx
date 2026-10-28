/**
 * Tests the overlay of a failed import: the server's reason, which stays English, is marked as English
 * while the note after it keeps the page's language
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportProgressOverlay } from '@/pages/imports/components'

function render(errorReason?: string) {
  return renderToStaticMarkup(
    <ImportProgressOverlay
      error="Nothing was added to your ledger."
      errorReason={errorReason}
      onScreen
      returnFocusTo={null}
      returnFocusFallbackRef={{ current: null }}
      onDone={() => {}}
      onReturnToImport={() => {}}
      phase="error"
      steps={undefined}
      summary=""
    />,
  )
}

describe('the overlay of a failed import', () => {
  it('marks the server\'s reason as English and leaves the note about what was saved unmarked', () => {
    const markup = render('Account is archived')

    // The screen reader's status line holds the reason too, so the marked reason shows twice
    expect(markup.match(/<span lang="en"[^>]*>Account is archived<\/span>/g)).toHaveLength(2)
    expect(markup).toMatch(/Account is archived<\/span>\s*Nothing was added to your ledger\./)
    expect(markup).not.toContain('Nothing was added to your ledger.</span>')
  })

  it('marks nothing as English when the failure has no server reason', () => {
    expect(render()).not.toContain('lang=')
  })
})
