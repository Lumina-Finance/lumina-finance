/**
 * Tests the transaction estimate the preview opens with while the chosen dates can't be applied: it
 * says the figure is unknown rather than counting rows the dates may leave out
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP, UNKNOWN_IMPORT_FIGURE } from '@/pages/imports/constants'
import { ImportPreviewLayout } from '@/pages/imports/sections/ImportPreviewLayout'
import type { ImportDateRange, ImportFileDraft } from '@/pages/imports/types'
import { countImportRowsOutsideDateRange, getCsvImportStats, getImportDateRangeFilter } from '@/pages/imports/utils'
import type { ImportDateFormat } from '@/pages/imports/utils/valueParsers'

const FILE: ImportFileDraft = {
  id: 'file-1',
  name: 'Checking.csv',
  size: 512,
  headers: ['Date', 'Amount'],
  hasHeaderRow: true,
  rows: ['2025-01-15', '2025-03-15', '2025-05-15'].map((Date) => ({ Date, Amount: '-1.00' })),
  error: null,
}

/**
 * Reads the Will Create figure the preview shows for the range and format given, counted the way the
 * workflow counts it
 */
function renderEstimate(dateRange: ImportDateRange, dateFormat: ImportDateFormat | null) {
  const filter = getImportDateRangeFilter({ columnMap: { ...EMPTY_COLUMN_MAP, dt: 'Date' }, dateFormat, dateRange })
  const stats = getCsvImportStats({
    rowCount: FILE.rows.length,
    outsideRangeRowCount: countImportRowsOutsideDateRange([FILE], filter),
    importBuild: { payload: null, rowProblems: [] },
    accountSources: [],
    accountMappings: {},
    importedCategories: [],
    categoryMappings: {},
    categoryById: new Map(),
    categoryCreateKinds: {},
    categoryRenames: {},
    categoryTypesBySource: {},
  })
  const markup = renderToStaticMarkup(
    <ImportPreviewLayout
      index="07"
      stats={stats}
      previewGroups={[]}
      emptyDescription="Mapped rows will appear here."
      importError={null}
      imported={false}
      canCommit={false}
      onCommit={() => {}}
    />,
  )
  return markup.match(/Will Create<\/p><p[^>]*>([^<]*)<\/p>/)?.[1]
}

describe('the estimate while the chosen dates can\'t be applied', () => {
  it.each([
    { name: 'before the date format is settled', dateRange: { from: '2025-03-01', to: '' }, dateFormat: null },
    { name: 'while the ends are crossed', dateRange: { from: '2025-04-01', to: '2025-03-01' }, dateFormat: 'yearFirst' as const },
    { name: 'while a date is only partly typed', dateRange: { from: null, to: '2025-03-31' }, dateFormat: 'yearFirst' as const },
  ])('shows the estimate as unknown $name', ({ dateRange, dateFormat }) => {
    expect(renderEstimate(dateRange, dateFormat)).toBe(UNKNOWN_IMPORT_FIGURE)
  })

  // The same reading with a range that applies, so the pattern can't pass by matching nothing
  it('shows the rows inside the dates once they apply', () => {
    expect(renderEstimate({ from: '2025-03-01', to: '2025-03-31' }, 'yearFirst')).toBe('1')
  })
})
