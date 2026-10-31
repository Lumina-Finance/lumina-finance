/**
 * Covers the review modal's decision button when a decision takes two presses
 *
 * These tests catch the two labels not both being drawn (so one pops in instead of fading), the
 * crossfade running with a literal timing, and a plain decision gaining the stacked labels
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ReviewDecisionButton } from '@/components/transactions/bank-review/DecisionButton'

// The crossfade needs a browser to mount, so the button's content is drawn without its animated layers
vi.mock('@/components/loading/Crossfade', () => ({ Crossfade: ({ children }: { children: unknown }) => children }))

function render(confirm?: { label: string; announcement: string }): string {
  return renderToStaticMarkup(
    createElement(ReviewDecisionButton, {
      label: 'Dismiss',
      tone: 'danger',
      loading: false,
      disabled: false,
      onClick: () => {},
      confirm,
    }),
  )
}

describe('a two-press decision button', () => {
  const confirm = { label: 'Yes, dismiss', announcement: 'Press again.' }

  it('draws both labels stacked, fading by opacity, with the first shown to start', () => {
    const markup = render(confirm)

    expect(markup).toMatch(/opacity:1[^>]*>Dismiss<\/span>/)
    expect(markup).toMatch(/opacity:0[^>]*>Yes, dismiss<\/span>/)
    expect(markup).toContain('transition-opacity')
  })

  it('names the button by the label shown, not by both', () => {
    expect(render(confirm)).toContain('aria-label="Dismiss"')
  })

  it('keeps a plain decision to its one label', () => {
    const markup = render()

    expect(markup).not.toContain('transition-opacity')
    expect(markup).toContain('>Dismiss</button>')
  })
})
