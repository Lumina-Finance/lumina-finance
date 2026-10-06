/**
 * Tests the lines a bank export puts around its table, found and left out by the CSV reader where
 * the flow offers reading choices: lines above the header row, and the last lines the user skips
 */
import { describe, expect, it } from 'vitest'
import { readCsvFile } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])

function read(csv: string, choices: { headerRow?: number; skipLastRows?: number } = {}) {
  return readCsvFile(new File([csv], 'statement.csv'), SUPPORTED_CURRENCY_CODES, {
    requireDataRows: true,
    offersReadingChoices: true,
    ...choices,
  })
}

const TABLE = 'Date;Description;Amount\n2026-10-01;Coffee;-4.50\n2026-10-02;Pay;2500.00\n'

/** Each preview line as its number and whether it is skipped */
function previewOf(draft: Awaited<ReturnType<typeof read>>) {
  return draft.reading?.preview.map((line) => [line.rowNumber, line.isSkipped])
}

describe('lines above the header row', () => {
  it('finds the header below one line of account details and skips that line', async () => {
    const draft = await read(`Account: 12-3456-7890, Everyday\n${TABLE}`)

    expect(draft.error).toBeNull()
    expect(draft.headers).toEqual(['Date', 'Description', 'Amount'])
    expect(draft.rows).toHaveLength(2)
    expect(draft.reading).toMatchObject({ headerRow: 2, skipLastRows: 0 })
    expect(previewOf(draft)).toEqual([[1, true], [2, false], [3, false], [4, false]])
  })

  it('finds the header below several lines', async () => {
    const draft = await read(`Everyday account\nAccount: 12-3456-7890\nOctober 2026\n${TABLE}`)

    expect(draft.headers).toEqual(['Date', 'Description', 'Amount'])
    expect(draft.reading?.headerRow).toBe(4)
    expect(draft.rows.map((row) => row.Description)).toEqual(['Coffee', 'Pay'])
  })

  // A title line as wide as the table is taken for its first row, which the user corrects
  it('reads from the header row the user chose', async () => {
    const draft = await read(`Account;Everyday;CAD\n${TABLE}`, { headerRow: 2 })
    expect(draft.headers).toEqual(['Date', 'Description', 'Amount'])
    expect(draft.rows).toHaveLength(2)
    expect(previewOf(draft)?.[0]).toEqual([1, true])
  })

  it('reads a file with its header on the first line as it did before', async () => {
    const draft = await read(TABLE)
    const withoutChoices = await readCsvFile(new File([TABLE], 'statement.csv'), SUPPORTED_CURRENCY_CODES, { requireDataRows: true })

    expect(draft.reading).toMatchObject({ headerRow: 1, skipLastRows: 0 })
    expect([draft.headers, draft.rows]).toEqual([withoutChoices.headers, withoutChoices.rows])
    expect(withoutChoices.reading).toBeUndefined()
  })
})

describe('lines skipped at the end', () => {
  const FOOTER = 'Latest transactions;2;CAD;2495.50;closing\nPrinted;2026-10-03;page;1;of 1\n'

  it('refuses a summary wider than the table, naming its line in the file and the rows to skip', async () => {
    const draft = await read(`Account: 12-3456-7890, Everyday\n${TABLE}${FOOTER}`)

    expect(draft.error).toContain('Row 5 has 5 values against 3 columns')
    expect(draft.error).toContain('set Skip last rows to 2')
    expect(draft.reading).toMatchObject({ headerRow: 2, skipLastRows: 0, suggestedSkipLastRows: 2 })
  })

  it('reads the rest once those lines are skipped, without counting them as rows', async () => {
    const draft = await read(`${TABLE}${FOOTER}`, { skipLastRows: 2 })

    expect(draft.error).toBeNull()
    expect(draft.rows.map((row) => row.Description)).toEqual(['Coffee', 'Pay'])
    expect(previewOf(draft)?.slice(-2)).toEqual([[4, true], [5, true]])
  })

  // A footer with more lines than the statement has transactions would otherwise set the table's width
  it('finds the header among the lines kept, not the skipped ones', async () => {
    const draft = await read('Account: 1\nDate;Description;Amount\n2026-10-01;Coffee;-4.50\nSummary;2;CAD;1;x\nPrinted;a;b;c;d\nEnd;e;f;g;h\n', { skipLastRows: 3 })

    expect(draft.reading?.headerRow).toBe(2)
    expect(draft.rows.map((row) => row.Description)).toEqual(['Coffee'])
  })

  it('previews the first and last lines of a longer file, marking the skipped ones at both ends', async () => {
    const rows = Array.from({ length: 8 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')};Shop ${index + 1};-1.00`)
    const draft = await read(['Account: 1', 'Date;Description;Amount', ...rows, 'Total;8;CAD;-8.00;x', 'Printed;a;b;c;d'].join('\n'), { skipLastRows: 2 })

    expect(previewOf(draft)).toEqual([[1, true], [2, false], [3, false], [4, false], [9, false], [10, false], [11, true], [12, true]])
  })

  // The hook carries the header row into the next read only when one was found, as here
  it('keeps every transaction of a file with no heading row when its last lines are skipped', async () => {
    const csv = '2026-10-01;Coffee;-4.50\n2026-10-02;Pay;2500.00\n2026-10-03;Rent;-1200.00\nTotal;3;CAD;1295.50;closing\n'
    const first = await read(csv)
    expect(first.reading?.headerRow).toBeNull()

    const draft = await read(csv, { headerRow: first.reading?.headerRow ?? undefined, skipLastRows: 1 })
    expect(draft.hasHeaderRow).toBe(false)
    expect(draft.rows.map((row) => row['Column 2'])).toEqual(['Coffee', 'Pay', 'Rent'])
  })
})

describe('a header narrower than its rows', () => {
  // Each row ends with a separator the header lacks, which was refused before lines could be skipped
  it('is still read as the header and the rows refused, rather than read without headings', async () => {
    const draft = await read('Date,Description,Amount\n2026-10-01,Coffee,-4.50,\n2026-10-02,Pay,2500.00,\n')

    expect(draft.reading?.headerRow).toBe(1)
    expect(draft.error).toContain('Row 2 has 4 values against 3 columns')
  })
})
