/**
 * Tests that files added to an import keep the first file's layout, refuse a file that breaks it or
 * the limits by name while keeping the files already staged, and say nothing extra for one file
 */
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildImportAnswerScope,
  getFileAccountSourceId,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  removeStagedFile,
  restageImportFiles,
  stageImportFiles,
  type StagingCandidate,
} from '@/pages/imports/utils'

const HEADERS = ['Date', 'Amount']

/**
 * Builds a file the reader accepted, with the headings and separator that make up its layout
 */
function draft(name: string, overrides: Partial<ImportFileDraft> = {}): ImportFileDraft {
  return {
    id: `id-${name}`,
    name,
    size: 100,
    headers: HEADERS,
    hasHeaderRow: true,
    rows: [{ Date: '2024-03-01', Amount: '-1.00' }],
    error: null,
    delimiter: ',',
    ...overrides,
  }
}

/**
 * Pairs a draft with the file it was read from, which two picks of one export share
 */
function candidate(name: string, overrides: Partial<ImportFileDraft> = {}): StagingCandidate {
  return { draft: draft(name, overrides), source: new File(['x'], name, { lastModified: 1 }) }
}

describe('staging files with the first file setting the layout', () => {
  it('stages every file with the same headings and separator', () => {
    const { accepted, refusals } = stageImportFiles([], [candidate('2024-01.csv'), candidate('2024-02.csv')])

    expect(accepted.map(({ draft: file }) => file.name)).toEqual(['2024-01.csv', '2024-02.csv'])
    expect(refusals).toEqual([])
  })

  it('refuses a file with an extra column by name and keeps the rest', () => {
    const odd = candidate('2024-02.csv', { headers: [...HEADERS, 'Balance'] })

    const { accepted, refusals } = stageImportFiles([], [candidate('2024-01.csv'), odd, candidate('2024-03.csv')])

    expect(accepted.map(({ draft: file }) => file.name)).toEqual(['2024-01.csv', '2024-03.csv'])
    expect(refusals).toEqual(['"2024-02.csv" was not added. Its columns don\'t match the first file.'])
  })

  it('refuses a file read with another separator even when its headings read the same', () => {
    const { refusals } = stageImportFiles([candidate('2024-01.csv')], [candidate('2024-02.csv', { delimiter: ';' })])

    expect(refusals).toEqual(['"2024-02.csv" was not added. Its columns don\'t match the first file.'])
  })

  it('checks a file added later against the files already staged', () => {
    const staged = [candidate('2024-01.csv')]

    const { accepted, refusals } = stageImportFiles(staged, [candidate('2024-02.csv', { headers: ['Day', 'Amount'] })])

    expect(accepted).toEqual([])
    expect(refusals).toHaveLength(1)
  })

  it('names a file the reader refused instead of showing its reason alone, once there are several', () => {
    const unreadable = candidate('2024-02.csv', { headers: [], rows: [], error: 'This file is not readable.' })

    const { refusals } = stageImportFiles([candidate('2024-01.csv')], [unreadable])

    expect(refusals).toEqual(['"2024-02.csv" was not added. This file is not readable.'])
  })

  it('refuses a file picked again, even when the second pick names it the same', () => {
    const again = { draft: draft('2024-01.csv', { id: 'other' }), source: new File(['x'], '2024-01.csv', { lastModified: 1 }) }
    const first = candidate('2024-01.csv')

    const { accepted, refusals } = stageImportFiles([], [first, again])

    expect(accepted).toHaveLength(1)
    expect(refusals).toEqual(['"2024-01.csv" was not added. It is already added.'])
  })

  it('keeps a file with the same name as a staged one when it is a different export', () => {
    const changed = { draft: draft('statement.csv', { id: 'b' }), source: new File(['x'], 'statement.csv', { lastModified: 2 }) }

    const { accepted } = stageImportFiles([], [candidate('statement.csv'), changed])

    expect(accepted).toHaveLength(2)
  })
})

describe('the size and row limits across the files', () => {
  it('refuses the file that takes the total size over the limit', () => {
    const part = 15 * 1024 * 1024

    const { accepted, refusals } = stageImportFiles([], [
      candidate('2024-01.csv', { size: part }),
      candidate('2024-02.csv', { size: part }),
    ])

    expect(accepted.map(({ draft: file }) => file.name)).toEqual(['2024-01.csv'])
    expect(refusals).toEqual(['"2024-02.csv" was not added. Together the files would be 30.0 MB, and the importer reads up to 25.0 MB.'])
  })

  it('accepts files whose total size is exactly the limit', () => {
    const half = MAX_IMPORT_FILE_BYTES / 2

    const { refusals } = stageImportFiles([], [
      candidate('2024-01.csv', { size: half }),
      candidate('2024-02.csv', { size: half }),
    ])

    expect(refusals).toEqual([])
  })

  it('refuses the file that takes the total rows over the limit', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, () => ({ Date: '2024-03-01', Amount: '-1.00' }))

    const { refusals } = stageImportFiles([candidate('2024-01.csv', { rows })], [candidate('2024-02.csv')])

    expect(refusals).toEqual(['"2024-02.csv" was not added. Together the files would have 100,001 rows, and the importer reads up to 100,000.'])
  })
})

describe('checking the staged files again after they are read with new choices', () => {
  const errorsOf = (files: StagingCandidate[]) => files.map(({ draft: file }) => [file.name, file.error])

  it('leaves files that still share the first file\'s layout as they were', () => {
    const files = [candidate('a.csv'), candidate('b.csv')]

    expect(restageImportFiles(files)).toEqual(files)
  })

  it('keeps a file whose headings no longer match staged, with the reason as its error and no rows', () => {
    const restaged = restageImportFiles([
      candidate('a.csv'),
      candidate('b.csv', { headers: ['Date', 'Total'] }),
      candidate('c.csv'),
    ])

    expect(errorsOf(restaged)).toEqual([['a.csv', null], ['b.csv', 'Its columns don\'t match the first file.'], ['c.csv', null]])
    expect(restaged[1].draft.rows).toEqual([])
  })

  it('keeps the file that pushes the total rows over the limit staged, with the reason as its error', () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, () => ({ Date: '2024-03-01', Amount: '-1.00' }))

    const restaged = restageImportFiles([candidate('a.csv', { rows }), candidate('b.csv')])

    expect(errorsOf(restaged)).toEqual([
      ['a.csv', null],
      ['b.csv', 'Together the files would have 100,001 rows, and the importer reads up to 100,000.'],
    ])
  })

  // The limit is on all the files held together, so a file that fits beside the first can still be
  // the one that pushes a later file over it
  it('counts every file held before a file against the limit, not only the first', () => {
    const rows = (count: number) => Array.from({ length: count }, () => ({ Date: '2024-03-01', Amount: '-1.00' }))

    const restaged = restageImportFiles([
      candidate('a.csv', { rows: rows(MAX_IMPORT_ROWS / 2) }),
      candidate('b.csv', { rows: rows(MAX_IMPORT_ROWS / 2) }),
      candidate('c.csv'),
    ])

    expect(errorsOf(restaged)).toEqual([
      ['a.csv', null],
      ['b.csv', null],
      ['c.csv', 'Together the files would have 100,001 rows, and the importer reads up to 100,000.'],
    ])
  })

  it('keeps the file that pushes the total size over the limit staged, with the reason as its error', () => {
    const restaged = restageImportFiles([candidate('a.csv', { size: MAX_IMPORT_FILE_BYTES }), candidate('b.csv')])

    expect(restaged[0].draft.error).toBeNull()
    expect(restaged[1].draft.error).toMatch(/^Together the files would be .+, and the importer reads up to .+\.$/)
  })

  it('leaves every file as it was when the first one is still unreadable, so its reading can be changed', () => {
    const files = [candidate('a.csv', { error: 'No transactions.' }), candidate('b.csv')]

    expect(restageImportFiles(files)).toEqual(files)
  })

  it('leaves a later file that has an error of its own with that error', () => {
    const broken = candidate('b.csv', { error: 'No transactions.', headers: [], rows: [] })

    expect(restageImportFiles([candidate('a.csv'), broken])[1]).toBe(broken)
  })
})

describe('the row limit across the files', () => {
  const fill = (count: number) => Array.from({ length: count }, () => ({ Date: '2024-03-01', Amount: '-1.00' }))

  it('accepts files whose total rows are exactly the limit', () => {
    const { accepted, refusals } = stageImportFiles([candidate('2024-01.csv', { rows: fill(MAX_IMPORT_ROWS - 1) })], [candidate('2024-02.csv')])

    expect(accepted).toHaveLength(1)
    expect(refusals).toEqual([])
  })
})

describe('removing a staged file', () => {
  const files = [draft('2024-01.csv'), draft('2024-02.csv'), draft('2024-03.csv')]

  // The answers and the account are held under the first file's id, so losing it lost them all
  it('keeps the identity the answers are held under when the first file is removed', () => {
    const remaining = removeStagedFile(files, 'id-2024-01.csv')

    expect(remaining.map((file) => file.name)).toEqual(['2024-02.csv', '2024-03.csv'])
    expect(buildImportAnswerScope('Category', remaining)).toBe(buildImportAnswerScope('Category', files))
    expect(getFileAccountSourceId(remaining)).toBe(getFileAccountSourceId(files))
    // Each file keeps its own id, which the staged list draws it by, so its row stays put
    expect(remaining.map((file) => file.id)).toEqual(['id-2024-02.csv', 'id-2024-03.csv'])
  })

  it('keeps the identity through a second removal of the first file', () => {
    const remaining = removeStagedFile(removeStagedFile(files, 'id-2024-01.csv'), 'id-2024-02.csv')

    expect(getFileAccountSourceId(remaining)).toBe(getFileAccountSourceId(files))
  })

  it('leaves the first file alone when another is removed', () => {
    expect(removeStagedFile(files, 'id-2024-02.csv').map((file) => file.id)).toEqual(['id-2024-01.csv', 'id-2024-03.csv'])
  })

  it('leaves nothing when the last file is removed', () => {
    expect(removeStagedFile([files[0]], 'id-2024-01.csv')).toEqual([])
  })
})

describe('a single file', () => {
  it('is refused with the reason the reader gave, unchanged', () => {
    const refused = candidate('only.csv', { headers: [], rows: [], error: 'This file is not readable.', delimiter: undefined })

    expect(stageImportFiles([], [refused]).refusals).toEqual(['This file is not readable.'])
  })

  it('is staged whole when it has an error the reading choices can fix', () => {
    const fixable = candidate('only.csv', { headers: [], rows: [], error: 'Only one column was found.', reading: { headerRow: null, skipLastRows: 0, isSkipLastRowsDetected: false, preview: [] } })

    const { accepted, refusals } = stageImportFiles([], [fixable])

    expect(accepted).toHaveLength(1)
    expect(refusals).toEqual([])
  })

  it('turns away the files picked beside one that still needs its reading fixed', () => {
    const fixable = candidate('2024-01.csv', { headers: [], rows: [], error: 'Only one column was found.', reading: { headerRow: null, skipLastRows: 0, isSkipLastRowsDetected: false, preview: [] } })

    const { accepted, refusals } = stageImportFiles([], [fixable, candidate('2024-02.csv')])

    expect(accepted).toHaveLength(1)
    expect(refusals).toEqual(['"2024-02.csv" was not added. Fix the first file before adding more.'])
  })
})
