/**
 * Guards the pill a read-only record shows. The pill shows only the short "Read-only" label, so the
 * reason has to reach the reader another way: screen-reader-only text after the label holds all of it,
 * and the tooltip the pill carries shows all of it on hover, tap or, where the pill is a stop of its own,
 * keyboard focus. A row's pill takes no stop, so the row keeps one
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadOnlyReasonPill } from '@/components/tooltips/ReadOnlyReasonPill'
import { textOf } from '@tests/components/transactions/bank-review/fixtures'

const REASON = 'Records in other currencies are read-only. They can be archived or deleted'

/** The pill's own markup, read up to the closed tooltip it carries */
function pillOf(markup: string) {
  return markup.slice(markup.indexOf('<span id="row-read-only"')).split('<div data-testid="disabled-reason-tooltip"')[0]
}

describe('ReadOnlyReasonPill', () => {
  it('shows only the short label', () => {
    const pill = pillOf(renderToStaticMarkup(<ReadOnlyReasonPill id="row-read-only" reason={REASON} />))
    const shown = pill.replace(/<span class="sr-only">[\s\S]*?<\/span>/, '')

    expect(textOf(shown)).toBe('Read-only')
  })

  it('holds the whole reason after the label for a screen reader', () => {
    const pill = pillOf(renderToStaticMarkup(<ReadOnlyReasonPill id="row-read-only" reason={REASON} />))

    expect(textOf(pill)).toBe(`Read-only. ${REASON}`)
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
