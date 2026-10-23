/**
 * Tests that the UTF-8 note gives way to any staged file, and the upload card to a refused one, that
 * the card stays under files that read cleanly for adding more, that all of them return once the
 * files are removed or their import has finished, which also takes away Remove, and that the
 * Separator choice stays for a refused file
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TransactionImportResponse } from '@/api/transaction-imports'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import { ImportFilesStep } from '@/pages/imports/sections/ImportFilesStep'
import type { ImportFileDraft } from '@/pages/imports/types'

// The date field reads the signed-in user's time zone, which the markup does not depend on
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))

// The calendar is portalled into the document body, which a server render has none of
vi.mock('@/components/date-field/CalendarPopover', () => ({ default: () => null }))

// A semicolon file read by comma: one column, so the reader refused it
const REFUSED_FILE: ImportFileDraft = {
  id: 'file-1',
  name: 'Checking.csv',
  size: 512,
  headers: [],
  hasHeaderRow: true,
  rows: [],
  error: 'Only one column was found.',
  delimiter: ',',
}

// A file that read cleanly, so it carries a reading beside its separator
const GOOD_FILE: ImportFileDraft = {
  id: 'file-2',
  name: 'Savings.csv',
  size: 512,
  headers: ['Date', 'Amount'],
  hasHeaderRow: true,
  rows: [{ Date: '2025-01-15', Amount: '-1.00' }],
  error: null,
  delimiter: ',',
  reading: {
    headerRow: 1,
    skipLastRows: 0,
    preview: [
      { rowNumber: 1, cells: ['Date', 'Amount'], isSkipped: false },
      { rowNumber: 2, cells: ['2025-01-15', '-1.00'], isSkipped: false },
    ],
  },
}

// A finished import's result, with nothing created
const IMPORT_RESULT: TransactionImportResponse = {
  transactions_created: 0,
  transactions_already_imported: 0,
  accounts_created: 0,
  accounts_reused: 0,
  categories_created: 0,
  categories_reused: 0,
  merchants_created: 0,
  merchants_reused: 0,
  tags_created: 0,
  tags_reused: 0,
  affected_account_ids: [],
  account_source_ids: {},
  category_source_ids: {},
  created_account_ids: [],
  created_category_ids: [],
  created_merchant_ids: [],
  created_tag_ids: [],
}

/**
 * Renders the File step with the files given and nothing else going on, or with a finished import
 */
function renderStep(
  files: ImportFileDraft[],
  importResult: TransactionImportResponse | null = null,
  isProcessingFiles = false,
) {
  return renderToStaticMarkup(
    <ImportFilesStep
      inputRef={{ current: null }}
      files={files}
      isProcessingFiles={isProcessingFiles}
      fileIntakeError={null}
      totalRows={0}
      mappedFieldCount={0}
      handleFileChange={async () => {}}
      changeDelimiter={() => {}}
      changeHeaderRow={() => {}}
      changeSkipLastRows={() => {}}
      columnMap={EMPTY_COLUMN_MAP}
      dateRange={{ from: '', to: '' }}
      isDateRangeCrossed={false}
      latestStartSuggestion={null}
      setDateRangeEnd={() => {}}
      removeFile={() => {}}
      uploadBlockReason={null}
      importResult={importResult}
    />,
  )
}

describe('the upload card in the File step', () => {
  it('is hidden with the UTF-8 note while a refused file is staged, and back once it is removed', () => {
    const staged = renderStep([REFUSED_FILE])
    expect(staged).toContain('Checking.csv')
    expect(staged).not.toContain('Upload CSV files')
    expect(staged).not.toContain('Add more CSV files')
    expect(staged).not.toContain('Files are read as UTF-8')

    const removed = renderStep([])
    expect(removed).toContain('Upload CSV files')
    expect(removed).toContain('Files are read as UTF-8')
  })

  // The first file sets the layout, and the rest are added to it through the same card
  it('stays under the files that read cleanly for adding more, without the UTF-8 note', () => {
    const staged = renderStep([GOOD_FILE])
    expect(staged).toContain('Savings.csv')
    expect(staged).toContain('Add more CSV files')
    expect(staged).not.toContain('Upload CSV files')
    expect(staged).not.toContain('Files are read as UTF-8')
  })

  it('lists every staged file with its own Remove button and counts them', () => {
    const second = { ...GOOD_FILE, id: 'file-3', name: 'Chequing.csv' }
    const staged = renderStep([GOOD_FILE, second])

    expect(staged).toContain('Remove Savings.csv')
    expect(staged).toContain('Remove Chequing.csv')
    expect(staged).toMatch(/>Files<\/p><p[^>]*>2<\/p>/)
    expect(renderStep([GOOD_FILE])).toMatch(/>File<\/p><p[^>]*>1<\/p>/)
  })

  it('is back under the staged files of a finished import, which can no longer be removed', () => {
    const finished = renderStep([GOOD_FILE], IMPORT_RESULT)
    expect(finished).toContain('Savings.csv')
    expect(finished).toContain('Upload CSV files')
    expect(finished).not.toContain('Add more CSV files')
    expect(finished).not.toContain('Remove Savings.csv')

    // Removing is what a file still waiting to be imported offers
    expect(renderStep([GOOD_FILE])).toContain('Remove Savings.csv')
  })
})

describe('the empty state in the File step', () => {
  it('shows with no file staged, and gives way to the processing state while a file is read', () => {
    expect(renderStep([])).toContain('No files staged')

    const reading = renderStep([], null, true)
    expect(reading).toContain('Processing CSV')
    expect(reading).not.toContain('No files staged')
  })
})

describe('the Separator choice in the File step', () => {
  // A refused file has no reading, but the wrong separator is often what refused it, so the choice
  // that undoes it stays
  it('is shown for a refused file, with the chosen separator marked as at fault', () => {
    const markup = renderStep([REFUSED_FILE])
    expect(markup).toContain('role="radiogroup" aria-label="Separator" aria-invalid="true"')
    expect(markup).not.toContain('Header row')
  })
})
