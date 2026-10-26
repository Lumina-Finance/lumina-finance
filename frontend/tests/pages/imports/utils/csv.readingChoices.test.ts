/**
 * Tests the lines a bank export puts around its table, found and left out by the CSV reader where
 * the flow offers reading choices: lines above the header row, and the last lines the user skips
 */
import { describe, expect, it } from 'vitest'
import { getSharedReadingChoices, readCsvFile } from '@/pages/imports/utils'

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

describe('a closing line that sums the file', () => {
  const WITH_TOTAL = `${TABLE}Total;;2495.50\n`

  // A total in the date column spoils the guess at the date and amount formats, so a first reading
  // leaves it out, and the user can still bring it back
  it('is left out on a first reading, which shows it as used', async () => {
    const draft = await read(WITH_TOTAL)

    expect(draft.error).toBeNull()
    expect(draft.rows).toHaveLength(2)
    expect(draft.reading).toMatchObject({ skipLastRows: 1 })
    expect(previewOf(draft)).toEqual([[1, false], [2, false], [3, false], [4, true]])
  })

  it('stays in when the user chose to skip none', async () => {
    const draft = await read(WITH_TOTAL, { skipLastRows: 0 })

    expect(draft.rows).toHaveLength(3)
    expect(draft.reading).toMatchObject({ skipLastRows: 0 })
  })

  it('leaves a transaction alone that only has total in its description', async () => {
    const draft = await read(`${TABLE}2026-10-03;Total Wine;-30.00\n`)

    expect(draft.rows).toHaveLength(3)
    expect(draft.reading).toMatchObject({ skipLastRows: 0 })
  })

  // A merchant can be called just Total, and a transaction is never a summary since it carries a date
  it('leaves a dated transaction alone whose description is only Total', async () => {
    const draft = await read(`${TABLE}2026-10-03;Total;-30.00\n`)

    expect(draft.rows).toHaveLength(3)
    expect(draft.reading).toMatchObject({ skipLastRows: 0 })
  })

  it.each(['Subtotal', 'Sub-total', 'Grand total', 'Total:', 'TOTALS'])('is recognised when it reads %s', async (label) => {
    const draft = await read(`${TABLE}${label};;2495.50\n`)

    expect(draft.rows).toHaveLength(2)
    expect(draft.reading).toMatchObject({ skipLastRows: 1 })
  })

  it('is recognised in a later column of the line', async () => {
    const draft = await read(`${TABLE};Total;2495.50\n`)

    expect(draft.rows).toHaveLength(2)
  })

  it('leaves out every summary line closing the file', async () => {
    const draft = await read(`${TABLE}Subtotal;;2495.50\nGrand total;;2495.50\n`)

    expect(draft.rows).toHaveLength(2)
    expect(draft.reading).toMatchObject({ skipLastRows: 2 })
  })

  it('never leaves the file with nothing but a summary', async () => {
    const draft = await read('Date;Description;Amount\n2026-10-01;Coffee;-4.50\nTotal;;-4.50\n')

    expect(draft.rows).toHaveLength(1)
  })

  it('stays in on a flow that offers no reading choices', async () => {
    const draft = await readCsvFile(new File([WITH_TOTAL], 'statement.csv'), SUPPORTED_CURRENCY_CODES, { requireDataRows: true })

    expect(draft.reading).toBeUndefined()
    expect(draft.rows).toHaveLength(3)
  })

  // The count is one setting for the files staged together, but only a count the user chose is theirs
  // to carry over: a Total line closing one file says nothing about the ending of the next
  it('is not carried to a later file that has none', async () => {
    const first = await read(WITH_TOTAL)
    const second = await read(TABLE, getSharedReadingChoices(first.reading))

    expect(second.rows).toHaveLength(2)
    expect(second.reading).toMatchObject({ skipLastRows: 0 })
  })

  it('is found in a later file when the first file had none to skip', async () => {
    const first = await read(TABLE)
    const second = await read(WITH_TOTAL, getSharedReadingChoices(first.reading))

    expect(second.rows).toHaveLength(2)
    expect(second.reading).toMatchObject({ skipLastRows: 1 })
  })

  it('is carried to a later file when the user chose the count', async () => {
    const first = await read(WITH_TOTAL, { skipLastRows: 1 })
    const second = await read(`${TABLE}2026-10-03;Rent;-1200.00\n`, getSharedReadingChoices(first.reading))

    expect(second.rows).toHaveLength(2)
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
