/**
 * Tests that the dates to import sit in the File step's reading choices, after Skip last rows, and
 * show only once a column is mapped as the date
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ImportReadingChoices } from '@/pages/imports/components'
import type { ImportDateRange, ImportFileDraft } from '@/pages/imports/types'

// The date field reads the signed-in user's time zone, which the markup does not depend on
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))

// The calendar is portalled into the document body, which a server render has none of
vi.mock('@/components/date-field/CalendarPopover', () => ({ default: () => null }))

const FILE: ImportFileDraft = {
  id: 'file-1',
  name: 'Checking.csv',
  size: 512,
  headers: ['Date', 'Amount'],
  hasHeaderRow: true,
  rows: [{ Date: '2025-01-15', Amount: '-1.00' }],
  error: null,
  delimiter: ',',
  reading: {
    headerRow: 1,
    skipLastRows: 0,
    isSkipLastRowsDetected: false,
    preview: [
      { rowNumber: 1, cells: ['Date', 'Amount'], isSkipped: false },
      { rowNumber: 2, cells: ['2025-01-15', '-1.00'], isSkipped: false },
    ],
  },
}

/**
 * Renders the reading choices with the dates to import on or off
 */
function renderChoices(
  hasDateColumn: boolean,
  startSuggestion: string | null = null,
  disabled = false,
  dateRange: ImportDateRange = { from: '', to: '' },
  isDateRangeCrossed = false,
) {
  return renderToStaticMarkup(
    <ImportReadingChoices
      file={FILE}
      disabled={disabled}
      hasDateColumn={hasDateColumn}
      dateRange={dateRange}
      isDateRangeCrossed={isDateRangeCrossed}
      startSuggestion={startSuggestion}
      onDelimiterChange={() => {}}
      onHeaderRowChange={() => {}}
      onSkipLastRowsChange={() => {}}
      onDateRangeChange={() => {}}
    />,
  )
}

describe('the dates to import in the File step', () => {
  it('follow Skip last rows and hold both dates', () => {
    const markup = renderChoices(true)
    const skipLastRows = markup.indexOf('Skip last rows')
    const datesToImport = markup.indexOf('Dates to import')
    expect(skipLastRows).toBeGreaterThan(-1)
    expect(datesToImport).toBeGreaterThan(skipLastRows)
    expect(markup.indexOf('Start date')).toBeGreaterThan(datesToImport)
    expect(markup.indexOf('End date')).toBeGreaterThan(markup.indexOf('Start date'))
  })

  it('offer the day after the latest transaction above the start date, and nothing without one', () => {
    const label = 'Latest recorded transaction'
    const offered = renderChoices(true, '2025-06-02')
    expect(offered).toContain(label)
    expect(offered.indexOf(label)).toBeGreaterThan(offered.indexOf('Start date'))
    expect(offered.indexOf(label)).toBeLessThan(offered.indexOf('End date'))

    expect(renderChoices(true, null)).not.toContain(label)
    expect(renderChoices(true, '2025-06-02', true)).not.toContain(label)
  })

  it('hold the offer back for as long as the start date has an error', () => {
    const label = 'Latest recorded transaction'
    const crossed = renderChoices(true, '2025-06-02', false, { from: '2025-04-01', to: '2025-03-01' }, true)
    expect(crossed).toContain('Must be on or before the end date')
    expect(crossed).not.toContain(label)

    const partlyTyped = renderChoices(true, '2025-06-02', false, { from: null, to: '2025-03-10' }, true)
    expect(partlyTyped).toContain('Enter the whole date, or clear it')
    expect(partlyTyped).not.toContain(label)

    expect(renderChoices(true, '2025-06-02', false, { from: '2025-02-01', to: '2025-03-01' })).toContain(label)
  })

  it('keep the partly typed message and leave out the crossed one', () => {
    const markup = renderChoices(true, null, false, { from: null, to: '2025-03-10' }, true)
    expect(markup).toContain('Enter the whole date, or clear it')
    expect(markup).not.toContain('Must be on or before the end date')
  })

  // Not shown disabled beforehand, since a range is read through the date column
  it('are absent while no column is mapped as the date', () => {
    const markup = renderChoices(false)
    expect(markup).not.toContain('Dates to import')
    expect(markup).not.toContain('Start date')
  })
})
