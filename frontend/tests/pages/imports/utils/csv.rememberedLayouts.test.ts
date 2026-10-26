/**
 * Tests reading a file with a saved layout when the file has that layout's headers, which is what
 * lets a bank's export open with the separator and header row the user corrected last time rather
 * than detection's, and that no count of last rows to skip is carried over, since a footer's length
 * changes from one export to the next
 */
import { describe, expect, it } from 'vitest'
import { readCsvFileWithLayout, type CsvLayoutReading } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])

// Detection takes the title line, as wide as the table, for the table's first row and finds no header
// row, which the user corrected to line 2
const TITLED_TABLE = 'Account;Everyday;CAD\nDate;Description;Amount\n2026-10-01;Coffee;-4.50\n2026-10-02;Pay;2500.00\nTotal;;2495.50\n'

const SAVED: CsvLayoutReading = {
  headers: ['Date', 'Description', 'Amount'],
  delimiter: ';',
  headerRow: 2,
}

function read(csv: string, layouts: CsvLayoutReading[]) {
  return readCsvFileWithLayout(new File([csv], 'statement.csv'), SUPPORTED_CURRENCY_CODES, {
    requireDataRows: true,
    offersReadingChoices: true,
  }, layouts)
}

describe('reading a file with a saved layout', () => {
  it('reads from the saved header row where detection finds no header row, leaving out only a closing total', async () => {
    const detected = await read(TITLED_TABLE, [])
    expect(detected.draft.hasHeaderRow).toBe(false)

    const { draft, layout } = await read(TITLED_TABLE, [SAVED])

    expect(layout).toBe(SAVED)
    expect(draft.error).toBeNull()
    expect(draft.headers).toEqual(SAVED.headers)
    expect(draft.delimiter).toBe(';')
    expect(draft.reading).toMatchObject({ headerRow: 2, skipLastRows: 1 })
    expect(draft.rows.map((row) => row.Date)).toEqual(['2026-10-01', '2026-10-02'])
  })

  it('reads with the saved separator where detection guesses another', async () => {
    // Either separator splits every line evenly, and detection settles on the comma
    const file = 'Date,Details;Reference;Memo\n2026-10-01,Coffee;A1;Card\n2026-10-02,Pay;B2;Transfer\n'
    const saved = { headers: ['Date,Details', 'Reference', 'Memo'], delimiter: ';' as const, headerRow: 1 }
    const detected = await read(file, [])
    expect(detected.draft.delimiter).toBe(',')

    const { draft, layout } = await read(file, [saved])

    expect(layout).toBe(saved)
    expect(draft.delimiter).toBe(';')
    expect(draft.headers).toEqual(saved.headers)
    expect(draft.rows).toHaveLength(2)
  })

  it('matches a file whose heading is blank or repeated by the names the page gave those headings', async () => {
    const file = 'Date;;Amount;Amount\n2026-10-01;Coffee;-4.50;-4.50\n'
    const saved = { headers: ['Date', 'Column 2', 'Amount', 'Amount 2'], delimiter: ';' as const, headerRow: 1 }

    const { draft, layout } = await read(file, [saved])

    expect(layout).toBe(saved)
    expect(draft.headers).toEqual(saved.headers)
  })

  it('reads by detection when no saved layout has the file’s headers at its header row', async () => {
    const otherHeaders = { ...SAVED, headers: ['Booked', 'Payee', 'Amount'] }
    const sameHeadersElsewhere = { ...SAVED, headerRow: 3 }

    const { draft, layout } = await read(TITLED_TABLE, [otherHeaders, sameHeadersElsewhere])

    expect(layout).toBeNull()
    expect(draft.hasHeaderRow).toBe(false)
  })

  it('uses the first of the layouts that match', async () => {
    const older = { ...SAVED, headerRow: 3 }
    const file = 'Account;Everyday;CAD\nDate;Description;Amount\nDate;Description;Amount\n2026-10-01;Coffee;-4.50\n'

    const { draft, layout } = await read(file, [older, SAVED])

    expect(layout).toBe(older)
    expect(draft.reading).toMatchObject({ headerRow: 3 })
  })

  it('matches header cells exactly, case included', async () => {
    const { layout } = await read(TITLED_TABLE, [{ ...SAVED, headers: ['date', 'Description', 'Amount'] }])

    expect(layout).toBeNull()
  })
})
