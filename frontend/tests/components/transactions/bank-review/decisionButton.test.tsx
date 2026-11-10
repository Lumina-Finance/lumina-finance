/**
 * Covers the review modal's decision button when a decision takes two presses
 *
 * These tests catch the second label showing before the first press, and the button named by both
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

  it('shows the first label alone to start, the second waiting for the first press', () => {
    const markup = render(confirm)

    expect(markup).toContain('>Dismiss</span>')
    expect(markup).not.toContain('Yes, dismiss')
  })

  it('names the button by the label shown, not by both', () => {
    expect(render(confirm)).toContain('aria-label="Dismiss"')
  })

  it('takes a modal footer row on a phone, unless a list row asks to stay beside its text', () => {
    const tag = (fullWidthOnPhone?: boolean) =>
      renderToStaticMarkup(
        createElement(ReviewDecisionButton, {
          label: 'Dismiss',
          tone: 'danger',
          loading: false,
          disabled: false,
          onClick: () => {},
          fullWidthOnPhone,
        }),
      ).match(/<button[^>]*>/)?.[0]

    expect(tag()).toContain('w-full sm:w-auto')
    expect(tag(false)).not.toContain('w-full')
  })

  it('keeps a plain decision to its one label', () => {
    expect(render()).toMatch(/aria-label="Dismiss"[^>]*>(<[^>]*>)*Dismiss</)
  })
})
