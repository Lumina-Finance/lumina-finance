/**
 * Verifies a hint button renders as a plain button that keeps its name and carries no native title, so the
 * browser's tooltip never shows beside the app's own
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { HintButton } from '@/components/tooltips/HintButton'

describe('HintButton', () => {
  it('renders a typed button named by its label, with no title', () => {
    const markup = renderToStaticMarkup(
      <HintButton hint="Show income breakdown" aria-label="Show income breakdown" className="app-icon-button" />,
    )

    expect(markup).toContain('type="button"')
    expect(markup).toContain('aria-label="Show income breakdown"')
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-disabled')
    expect(markup).not.toContain('aria-describedby')
  })

  it('keeps a submit type and stays enabled while a hint is set', () => {
    const markup = renderToStaticMarkup(<HintButton type="submit" hint="Save" aria-label="Save" />)

    expect(markup).toContain('type="submit"')
    expect(markup).not.toContain('disabled=""')
  })

  it('draws a disabled reason button the same with a hint, until its reason holds', () => {
    const available = renderToStaticMarkup(<DisabledReasonButton hint="Delete account" aria-label="Delete account" />)
    const held = renderToStaticMarkup(
      <DisabledReasonButton hint="Delete account" disabledReason="Finish first" aria-label="Delete account" />,
    )

    expect(available).not.toContain('title=')
    expect(available).not.toContain('aria-disabled')
    expect(held).toContain('aria-disabled="true"')
    expect(held).not.toContain('title=')
  })
})
