/**
 * Covers what the confirmation shows, since a long list of choices must stay readable one name at a
 * time and a name holding a comma must not read as two
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExportSummary } from '@/components/transactions/export/ExportSummary'

describe('ExportSummary', () => {
  it('shows only the sentence when nothing narrows the file', () => {
    const markup = renderToStaticMarkup(
      <ExportSummary description={{ summary: 'The file will hold all transactions.', groups: [] }} />,
    )

    expect(markup).toContain('The file will hold all transactions.')
    expect(markup).not.toContain('<dl')
  })

  it('shows each choice as its own chip under its condition, wrapping a long list', () => {
    const names = Array.from({ length: 12 }, (_, index) => `Category ${index} with a long name`)
    const markup = renderToStaticMarkup(
      <ExportSummary
        description={{
          summary: 'The file will hold the transactions that match everything below.',
          groups: [
            { label: 'Category', values: [...names, 'Food, drink'] },
            { label: 'Accounts', values: ['Everyday'] },
          ],
        }}
      />,
    )

    expect(markup).toContain('flex-wrap')
    expect(markup).toContain('>Food, drink</span>')
    for (const name of names) expect(markup).toContain(`>${name}</span>`)
    expect(markup.indexOf('Category</dt>')).toBeLessThan(markup.indexOf('Accounts</dt>'))
  })
})
