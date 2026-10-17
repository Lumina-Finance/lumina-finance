/**
 * Tests the lead cell that names a skipped row's file, so a long name is cut without cutting the
 * position that tells two files of one name apart
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SkippedFileNamedLead } from '@/pages/imports/components/tables/SkippedTable'

function render(fileName: string) {
  return renderToStaticMarkup(createElement(SkippedFileNamedLead, { lead: 'Feb 3', fileName }))
}

describe('SkippedFileNamedLead', () => {
  it('keeps the position of a shared name outside the part that is cut', () => {
    const markup = render('a-very-long-statement-name.qfx (file 2)')

    expect(markup).toContain('<span class="truncate">a-very-long-statement-name.qfx</span>')
    expect(markup).toContain('<span class="shrink-0 whitespace-pre"> (file 2)</span>')
  })

  it('keeps the whole name as the tooltip', () => {
    expect(render('statement.qfx (file 2)')).toContain('title="statement.qfx (file 2)"')
  })

  // A date such as "September 28, 2026" is wider than the column, and wrapping shows all of it
  it('lets what leads the row wrap instead of being cut', () => {
    const markup = renderToStaticMarkup(createElement(SkippedFileNamedLead, { lead: 'September 28, 2026', fileName: 'a.qfx' }))

    expect(markup).toContain('<span class="block whitespace-normal">September 28, 2026</span>')
  })

  it('cuts a name with no position as a whole', () => {
    const markup = render('statement.qfx')

    expect(markup).toContain('<span class="truncate">statement.qfx</span>')
    expect(markup).not.toContain('shrink-0')
  })
})
