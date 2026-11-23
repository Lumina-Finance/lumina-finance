/**
 * Guards the pill a read-only record shows its reason in. The pill stays one line, cutting a long reason
 * short, so the whole sentence has to reach the reader another way: the pill's own text holds all of it
 * for a screen reader, and the tooltip it carries shows all of it on hover, tap or, where the pill is a
 * stop of its own, keyboard focus. A row's pill takes no stop, so the row keeps one
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadOnlyReasonPill } from '@/components/tooltips/ReadOnlyReasonPill'

const REASON = 'Records in other currencies are read-only. They can be archived or deleted'

describe('ReadOnlyReasonPill', () => {
  it('holds the whole reason in its text', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill id="row-read-only" reason={REASON} />)
    const pill = markup.match(/<span id="row-read-only"[^>]*>(<span class="min-w-0 truncate">.*?<\/span>)/)

    expect(pill?.[1]).toBe(`<span class="min-w-0 truncate">${REASON}</span>`)
  })

  it('carries a tooltip with the reason, closed until a hover or a tap opens it', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill reason={REASON} />)
    const tooltip = markup.match(/<div data-testid="disabled-reason-tooltip"[^>]*style="([^"]*)"/)

    expect(tooltip).not.toBeNull()
    expect(tooltip?.[1]).toContain('opacity:0')
  })

  it('adds no hidden copy of the reason, since the pill already reads all of it', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill reason={REASON} />)

    expect(markup).not.toContain('hidden=""')
    expect(markup).not.toContain('aria-disabled')
  })

  it('takes no tab stop unless asked, so a row keeps its single stop', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill id="row-read-only" reason={REASON} />)

    expect(markup).not.toContain('tabindex')
  })

  it('takes a tab stop where nothing else carries the reason, as in a dialogue', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill id="dialogue-read-only" reason={REASON} focusable />)

    expect(markup).toMatch(/<span id="dialogue-read-only" data-testid="read-only-reason-pill" tabindex="0"/)
  })

  it('gives itself an id when the caller names none', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill reason={REASON} />)

    expect(markup).toMatch(/<span id="[^"]+" data-testid="read-only-reason-pill"/)
  })
})
