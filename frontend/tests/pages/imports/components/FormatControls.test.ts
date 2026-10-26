/**
 * Tests what the date format field shows once a format is chosen, so a long example never runs the
 * answer off the end of a field that is narrow at a tablet or phone
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportDateFormatControl } from '@/pages/imports/components/FormatControls'
import type { ImportDateFormat } from '@/pages/imports/utils'

/** Renders the closed date format field holding the given format */
function render(format: ImportDateFormat, automatic: boolean) {
  return renderToStaticMarkup(createElement(ImportDateFormatControl, {
    format,
    automatic,
    scan: { readable: [format], rejectedBy: {}, automatic: null, ambiguous: false },
    disabled: false,
    onChange: () => undefined,
  }))
}

describe('the date format field once a format is chosen', () => {
  it('shows a chosen ISO format by its name alone, since its example is wider than the field', () => {
    const markup = render('iso', false)

    expect(markup).toContain('ISO date/time')
    expect(markup).not.toContain('2026-04-30T12:00:00Z')
  })

  it('shows another chosen format with its example', () => {
    expect(render('dayFirst', false)).toContain('Day first (30/04/2026)')
  })
})
