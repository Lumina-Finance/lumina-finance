/**
 * Covers the link flow's choice card in each state it is drawn in: free, selected, held off by its own
 * request and locked with a reason
 *
 * These tests catch a selected card with no look for keyboard focus, a held-off card back on the faint
 * surface fill, a locked card that is natively disabled, so no tooltip reaches it, and a free card
 * drawn locked
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'

function render(props: { selected?: boolean; disabled?: boolean; unavailableReason?: string }): string {
  return renderToStaticMarkup(
    <ChoiceCard
      selected={props.selected ?? false}
      disabled={props.disabled}
      unavailableReason={props.unavailableReason}
      onSelect={() => {}}
    >
      Everyday
    </ChoiceCard>,
  )
}

describe('the choice card', () => {
  it('gives a selected card the stronger border for the pointer and keyboard focus', () => {
    expect(render({ selected: true })).toContain('hover:border-[var(--app-accent-nav-focus-border)]!')
    expect(render({ selected: false })).not.toContain('--app-accent-nav-focus-border')
  })

  it('draws a card held off by its own request with the shared input fill and border, still natively disabled', () => {
    const markup = render({ disabled: true })

    expect(markup).toContain('background:var(--app-input-bg)')
    expect(markup).toContain('border-color:var(--app-input-border)')
    expect(markup).not.toContain('--app-surface-soft')
    expect(markup).toMatch(/ disabled=""/)
  })

  it('locks a card with a reason: faded whole, a lock for the radio, reachable and described', () => {
    const markup = render({ unavailableReason: 'Already linked to Household' })

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).not.toMatch(/ disabled=""/)
    expect(markup).toContain('lucide-lock')
    expect(markup).toContain('opacity:0.55')
    expect(markup).toContain('Already linked to Household')
    expect(markup).not.toContain('hover:bg-')
  })

  it('leaves a free card with a radio, no lock and its hover fill', () => {
    const markup = render({})

    expect(markup).not.toContain('lucide-lock')
    expect(markup).not.toContain('aria-disabled="true"')
    expect(markup).toContain('hover:bg-[var(--app-hover-soft)]!')
  })
})
