/**
 * Guards the icon tooltip's options: a panel sized to its content unless the caller sets a width, a
 * trigger that is not a nested button inside a row that is already one, and an outline icon whose
 * strokes are not filled in on hover
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { Landmark } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import IconTooltip from '@/components/tooltips/IconTooltip'

describe('icon tooltip', () => {
  it('sizes the panel to its content up to the old fixed width unless the caller sets one', () => {
    const fitted = renderToStaticMarkup(<IconTooltip label="About this">Short note</IconTooltip>)
    const fixed = renderToStaticMarkup(
      <IconTooltip label="About this" widthClassName="w-72">Longer explanation</IconTooltip>,
    )

    expect(fitted).toContain('w-max max-w-52')
    expect(fixed).toContain('w-72')
    expect(fixed).not.toContain('w-max')
  })

  it('uses a focusable span acting as a button inside another control, never a nested button', () => {
    const markup = renderToStaticMarkup(
      <IconTooltip label="From the bank" insideControl>From the bank</IconTooltip>,
    )

    expect(markup).not.toContain('<button')
    expect(markup).toMatch(/<span[^>]*role="button"[^>]*tabindex="0"[^>]*aria-label="From the bank"/)
  })

  it('keeps an outline icon unfilled on hover when asked to', () => {
    const filled = renderToStaticMarkup(<IconTooltip label="About this">Note</IconTooltip>)
    const outline = renderToStaticMarkup(
      <IconTooltip label="From the bank" icon={Landmark} hoverFill={false}>Note</IconTooltip>,
    )

    expect(filled).toContain('group-hover:[&amp;&gt;*:first-child]:fill-current')
    expect(outline).not.toContain('fill-current')
  })
})
