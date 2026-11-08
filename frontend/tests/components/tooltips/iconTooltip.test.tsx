/**
 * Guards the icon tooltip's defaults: a panel 13rem wide, and one that a screen reader can read while
 * closed unless the trigger asks to hide it
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import IconTooltip from '@/components/tooltips/IconTooltip'

describe('icon tooltip', () => {
  it('hides the closed panel from assistive technology only when asked to, so only its trigger is read', () => {
    const asked = renderToStaticMarkup(
      <IconTooltip label="About this" hidesClosedPanel>
        Short note
      </IconTooltip>,
    )
    const plain = renderToStaticMarkup(<IconTooltip label="About this">Short note</IconTooltip>)

    expect(asked).toContain('aria-label="About this" aria-expanded="false"')
    expect(asked).toMatch(/<span [^>]*aria-hidden="true"[^>]*><span [^>]*>Short note</)
    expect(plain).toMatch(/<span [^>]*role="tooltip"/)
    expect(plain).not.toMatch(/<span [^>]*role="tooltip"[^>]*aria-hidden/)
  })

  it('is 13rem wide unless the caller sets a width', () => {
    const panelClasses = (markup: string) => markup.match(/class="app-tooltip-panel ([^"]*)"/)?.[1].split(' ') ?? []
    const plain = panelClasses(renderToStaticMarkup(<IconTooltip label="About this">Note</IconTooltip>))
    const fitted = panelClasses(
      renderToStaticMarkup(
        <IconTooltip label="About this" widthClassName="w-max max-w-52">
          Note
        </IconTooltip>,
      ),
    )

    expect(plain).toContain('w-52')
    expect(plain).not.toContain('w-max')
    expect(fitted).toContain('w-max')
    expect(fitted).not.toContain('w-52')
  })
})
