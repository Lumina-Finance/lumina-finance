/**
 * Guards that a closed icon tooltip's panel is not read by a screen reader, so only its trigger is
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import IconTooltip from '@/components/tooltips/IconTooltip'

describe('icon tooltip', () => {
  it('hides the closed panel from assistive technology, so only its trigger is read', () => {
    const markup = renderToStaticMarkup(<IconTooltip label="About this">Short note</IconTooltip>)

    expect(markup).toContain('aria-label="About this" aria-expanded="false"')
    expect(markup).toMatch(/<span [^>]*aria-hidden="true"[^>]*><span [^>]*>Short note</)
  })
})
