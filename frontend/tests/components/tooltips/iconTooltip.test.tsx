/**
 * Guards the icon tooltip's options: a panel sized to its content unless the caller sets a width, and
 * an outline icon whose strokes are not filled in on hover
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { Landmark } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import IconTooltip from '@/components/tooltips/IconTooltip'

/** The class names on the first element whose class list holds the given one */
function classesOf(markup: string, marker: string): string[] {
  for (const [, classes] of markup.matchAll(/class="([^"]*)"/g)) {
    const names = classes.split(/\s+/)
    if (names.includes(marker)) return names
  }
  return []
}

describe('icon tooltip', () => {
  it('sizes the panel to its content unless the caller sets a width', () => {
    const fitted = classesOf(renderToStaticMarkup(<IconTooltip label="About this">Short note</IconTooltip>), 'app-tooltip-panel')
    const fixed = classesOf(
      renderToStaticMarkup(<IconTooltip label="About this" widthClassName="w-72">Longer explanation</IconTooltip>),
      'app-tooltip-panel',
    )

    expect(fitted).toContain('w-max')
    expect(fixed).toContain('w-72')
    expect(fixed).not.toContain('w-max')
  })

  it('keeps an outline icon unfilled on hover when asked to', () => {
    const isFill = (name: string) => name.includes('fill-current')
    const filled = classesOf(renderToStaticMarkup(<IconTooltip label="About this">Note</IconTooltip>), 'lucide')
    const outline = classesOf(
      renderToStaticMarkup(<IconTooltip label="From the bank" icon={Landmark} hoverFill={false}>Note</IconTooltip>),
      'lucide',
    )

    expect(filled.some(isFill)).toBe(true)
    expect(outline.some(isFill)).toBe(false)
  })
})
