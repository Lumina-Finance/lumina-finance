/**
 * Guards the bank sync fact on the identity card. It sits in the facts' description list as one div
 * holding its term and value, with no wrapper around it, and fades in and out only where the card
 * asks for it
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BankSyncLabel } from '@/pages/accounts/detail/components/bank-link/status'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'

const SYNC: BankSyncLabel = { tone: 'ok', label: 'Synced just now', pulse: false, details: [] }

describe('the bank sync fact', () => {
  it('is one div holding its term and value, so the description list has no extra wrapper', () => {
    const markup = renderToStaticMarkup(<SyncFact name="Bank sync" sync={SYNC} fades />)

    expect(markup).toMatch(/^<div class="col-span-2 min-w-0"[^>]*><dt\b/)
  })

  it('starts hidden to fade in where the card asks, and is drawn plainly elsewhere', () => {
    expect(renderToStaticMarkup(<SyncFact name="Bank sync" sync={SYNC} fades />)).toMatch(
      /^<div class="col-span-2 min-w-0" style="opacity:0">/,
    )
    expect(renderToStaticMarkup(<SyncFact name="Status" sync={SYNC} />)).toMatch(/^<div class="col-span-2 min-w-0">/)
  })

  describe('its chevron', () => {
    const chevronClasses = (markup: string) =>
      markup.match(/<svg[^>]*class="([^"]*lucide-chevron-right[^"]*)"/)?.[1] ?? ''

    it('nudges 2px right under the pointer or keyboard focus, on the app ease, and holds still under reduced motion', () => {
      const classes = chevronClasses(renderToStaticMarkup(<SyncFact name="Bank sync" sync={SYNC} onOpen={() => {}} />))

      expect(classes).toContain('group-hover:translate-x-0.5')
      expect(classes).toContain('group-focus-visible:translate-x-0.5')
      expect(classes).toContain('transition-transform')
      // The duration and curve are the app's defaults for a transition, set once in the stylesheet
      expect(classes).not.toMatch(/\b(duration|ease)-/)
      expect(classes).toContain('motion-reduce:transition-none')
      expect(classes).toContain('motion-reduce:group-hover:translate-x-0')
      expect(classes).toContain('motion-reduce:group-focus-visible:translate-x-0')
    })

    it('sits 4px from the label and centres on its lowercase letters', () => {
      const classes = chevronClasses(renderToStaticMarkup(<SyncFact name="Bank sync" sync={SYNC} onOpen={() => {}} />))

      expect(classes).toContain('-ml-[9.33px]')
      expect(classes).toContain('top-px')
    })

    it('leaves the hover underline to the label by ending it where the chevron begins', () => {
      const markup = renderToStaticMarkup(<SyncFact name="Bank sync" sync={SYNC} onOpen={() => {}} />)

      expect(markup).toContain('[--link-underline-start:16px]')
      expect(markup).toContain('[--link-underline-end:14.67px]')
    })

    it('is absent where the fact opens nothing', () => {
      expect(renderToStaticMarkup(<SyncFact name="Status" sync={SYNC} />)).not.toContain('lucide-chevron-right')
    })
  })
})
