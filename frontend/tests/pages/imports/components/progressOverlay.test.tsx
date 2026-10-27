/**
 * Tests the overlay of a failed import: the server's reason, which stays English, is marked as English
 * and sits on its own line above the translated note
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
  it('sets the server\'s reason on its own line above the note about what was saved', () => {
    const markup = render('Account is archived')

    // The screen reader's status line holds the reason too, so the visible line is the one set as a block
    expect(markup.match(/<span lang="en">Account is archived<\/span>/g)).toHaveLength(1)
    expect(markup).toContain('<span lang="en" class="block">Account is archived</span>Nothing was added to your ledger.')
    expect(markup).not.toContain('Nothing was added to your ledger.</span>')
  })

  it('keeps the message and the button at the card\'s width only when a reason shows', () => {
    // The column and the message both fill the card, since each would otherwise shrink to its widest line
    expect(render('Account is archived')).toContain('w-full max-w-sm')
    expect(render('Account is archived')).toContain('leading-6 w-full')
    expect(render()).not.toContain('w-full max-w-sm')
    expect(render()).not.toContain('leading-6 w-full')
  })

  it('marks nothing as English when the failure has no server reason', () => {
    expect(render()).not.toContain('lang=')
  })
})
