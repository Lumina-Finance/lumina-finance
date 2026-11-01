/**
 * Tests the data source step names the QIF import for the one Quicken version it is checked against,
 * and flags it as beta beside the name like the other newer importers
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportSourceStep } from '@/pages/imports/sections/ImportSourceStep'

describe('ImportSourceStep', () => {
  it('shows the QIF import as Quicken 3.0 (QIF) with a Beta badge', () => {
    const markup = renderToStaticMarkup(<ImportSourceStep value="qif" onChange={() => undefined} />)

    expect(markup).toContain('Quicken 3.0 (QIF)')
    expect(markup).toContain('Beta')
  })

  it('shows no badge for the CSV import', () => {
    const markup = renderToStaticMarkup(<ImportSourceStep value="generic" onChange={() => undefined} />)

    expect(markup).not.toContain('Beta')
  })
})
