/**
 * Guards the pill a read-only record shows its reason in. The pill stays one line, cutting a long reason
 * short, so the whole sentence has to reach the reader another way: the pill's own text holds all of it
 * for a screen reader, and the tooltip it carries shows all of it on hover or tap
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadOnlyReasonPill } from '@/components/tooltips/ReadOnlyReasonPill'

const REASON = 'This server keeps records in other currencies read-only, so they can only be archived or deleted'

describe('ReadOnlyReasonPill', () => {
  it('holds the whole reason in one line it cuts short', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill id="row-read-only" reason={REASON} />)
    const pill = markup.match(/<span id="row-read-only"[^>]*>(<span class="min-w-0 truncate">.*?<\/span>)/)

    expect(pill?.[1]).toBe(`<span class="min-w-0 truncate">${REASON}</span>`)
    expect(pill?.[0]).toContain('max-w-full')
  })

  it('sits above a row’s press layer, so the hover and tap reach it', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill id="row-read-only" reason={REASON} />)

    expect(markup).toMatch(/<span id="row-read-only" data-testid="read-only-reason-pill" class="relative /)
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

  it('gives itself an id when the caller names none', () => {
    const markup = renderToStaticMarkup(<ReadOnlyReasonPill reason={REASON} />)

    expect(markup).toMatch(/<span id="[^"]+" data-testid="read-only-reason-pill"/)
  })
})
