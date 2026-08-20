/**
 * Tests what the importer accepts as a file, driving real CSV text through the reader rather than
 * handing it records, so the parser's own reading of quotes, line endings and column counts is what
 * is under test
 */
import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS, readCsvFile } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])

/**
 * Stages CSV text the way an upload does
 */
function stage(csv: string, requireDataRows = true) {
  return readCsvFile(new File([csv], 'statement.csv'), SUPPORTED_CURRENCY_CODES, { requireDataRows })
}

/**
 * Stands in for a file of the given size without allocating one, since only the size is read before
 * the file is refused
 */
function stageOversizedFile(size: number) {
  const file = new File(['Date,Amount\n2026-01-01,-5.00\n'], 'statement.csv')
  Object.defineProperty(file, 'size', { value: size })

  return readCsvFile(file, SUPPORTED_CURRENCY_CODES, { requireDataRows: true })
}

describe('reading a file whose rows would otherwise merge or vanish', () => {
  it('keeps two transactions apart when the file mixes line endings', async () => {
    // The parser guesses the ending by majority, so the one line ending the other way used to be
    // read as part of the cell before it, joining two transactions into a single row with no
    // complaint from the parser at all
    const draft = await stage('Date,Amount\r\n2026-01-01,5.00\n2026-01-02,6.00\r\n')

    expect(draft.error).toBeNull()
    expect(draft.rows).toHaveLength(2)
    expect(draft.rows[0]).toEqual({ Date: '2026-01-01', Amount: '5.00' })
    expect(draft.rows[1]).toEqual({ Date: '2026-01-02', Amount: '6.00' })
  })

  it('refuses a file whose quoted value is never closed', async () => {
    const draft = await stage('Date,Merchant,Amount\n2026-01-01,"Acme,-5.00\n2026-01-02,Beta,-6.00\n')

    expect(draft.error).toContain('never closed')
    expect(draft.rows).toHaveLength(0)
  })

  // The parser steps past a stray quote inside a field and keeps the row, so the file is whole and
  // refusing it would cost an import that loses nothing
  it('keeps a file whose stray quote the parser read through', async () => {
    const draft = await stage('Date,Merchant,Amount\n2026-01-01,ACME"S,-5.00\n2026-01-02,Beta,-6.00\n')

    expect(draft.error).toBeNull()
    expect(draft.rows).toHaveLength(2)
    expect(draft.rows[0].Merchant).toBe('ACME"S')
  })

  it('refuses a file with junk after a closing quote', async () => {
    const draft = await stage('Date,Amount\n"2026-01-01"x,5.00\n2026-01-02,6.00\n')

    expect(draft.error).toContain('never closed')
  })

  it('refuses a row carrying more values than there are columns', async () => {
    // An unquoted comma inside a company name, which used to stage the amount under the merchant
    // heading and drop the real amount entirely
    const draft = await stage('Date,Merchant,Amount\n2026-01-01,Acme, Inc,-5.00\n')

    expect(draft.error).toContain('Row 1')
    expect(draft.error).toContain('4 values against 3 columns')
  })

  it('still pads a row carrying fewer values than there are columns', async () => {
    // A trailing summary line is this shape, and it reaches the preview to be judged there rather
    // than taking the whole file down
    const draft = await stage('Date,Merchant,Amount\n2026-01-01,Acme,-5.00\nTotal\n')

    expect(draft.error).toBeNull()
    expect(draft.rows).toHaveLength(2)
    expect(draft.rows[1]).toEqual({ Date: 'Total', Merchant: '', Amount: '' })
  })

  it('gives a repeated heading a name no other column has taken', async () => {
    // Counting occurrences alone gave the third column the second one's name, and a row is keyed by
    // name, so the second column's values were overwritten while the column count still read three
    const draft = await stage('Amount,Amount 2,Amount\n1.00,2.00,3.00\n')

    expect(draft.error).toBeNull()
    expect(draft.headers).toEqual(['Amount', 'Amount 2', 'Amount 3'])
    expect(draft.rows[0]).toEqual({ 'Amount': '1.00', 'Amount 2': '2.00', 'Amount 3': '3.00' })
  })
})

describe('bounding what the importer will read', () => {
  it('refuses a file past the size it reads, without reading it', async () => {
    const draft = await stageOversizedFile(MAX_IMPORT_FILE_BYTES + 1)

    expect(draft.error).toContain('reads files up to')
    expect(draft.rows).toHaveLength(0)
  })

  it('stages a file at exactly the size it reads', async () => {
    const draft = await stageOversizedFile(MAX_IMPORT_FILE_BYTES)

    expect(draft.error).toBeNull()
  })

  it('refuses a file past the row count it reads', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => `2026-01-01,${index}`)
    const draft = await stage(`Date,Amount\n${rows.join('\n')}\n`)

    expect(draft.error).toContain('reads up to')
    expect(draft.rows).toHaveLength(0)
  })
})

describe('deciding a file is not a readable table', () => {
  it('refuses text in a two-byte encoding, which decodes to nulls rather than to replacements', async () => {
    // Every other byte of a UTF-16 export is a null, which decodes to a character the reader can
    // read, so counting the replacements the decoder wrote would let the file through
    const draft = await stage('D\u0000a\u0000t\u0000e\u0000,\u0000A\u0000m\u0000t\u0000\n')

    expect(draft.error).toContain('not readable as text')
  })

  it('refuses a file that is mostly characters the decoder could not read', async () => {
    const draft = await stage(`${'\uFFFD'.repeat(40)},${'\uFFFD'.repeat(40)}\n`)

    expect(draft.error).toContain('not readable as text')
  })

  it('stages a file with a few unreadable characters, saying how many', async () => {
    // A single-byte encoding such as Windows-1252 loses only its accented characters and the rest of
    // the file still reads, so locking the import out would cost more than it saves
    const draft = await stage(
      'Date,Merchant,Amount\n2026-01-01,Caf\uFFFD Bleu,-5.00\n2026-01-02,Boulangerie,-6.00\n',
    )

    expect(draft.error).toBeNull()
    expect(draft.notice).toBe('1 character could not be read')
    expect(draft.rows).toHaveLength(2)
  })

  it('refuses a file of one column', async () => {
    const draft = await stage('Amount\n5.00\n6.00\n')

    expect(draft.error).toContain('Only one column')
  })

  it('refuses a heading row with nothing under it', async () => {
    const draft = await stage('Date,Merchant,Amount\n')

    expect(draft.error).toContain('no transactions under it')
  })

  it('stages a heading row with nothing under it where the flow allows one', async () => {
    const draft = await stage('name,active,start_date,currency_code,amount\n', false)

    expect(draft.error).toBeNull()
    expect(draft.rows).toHaveLength(0)
    expect(draft.headers).toHaveLength(5)
  })

  it('refuses an entirely empty file', async () => {
    const draft = await stage('')

    expect(draft.error).toBe('No readable rows detected')
  })
})

describe('keeping what the reader already handled', () => {
  it('reads a quoted value carrying the delimiter and a newline', async () => {
    const draft = await stage('Date,Notes,Amount\n2026-01-01,"Paid ""in full"", see\nledger",-5.00\n')

    expect(draft.error).toBeNull()
    expect(draft.rows).toHaveLength(1)
    expect(draft.rows[0].Notes).toBe('Paid "in full", see\nledger')
  })

  it('reads a file written entirely with carriage returns', async () => {
    const draft = await stage('Date,Amount\r2026-01-01,5.00\r2026-01-02,6.00\r')

    expect(draft.error).toBeNull()
    expect(draft.rows).toHaveLength(2)
  })

  it('reads a file starting with a byte order mark', async () => {
    const draft = await stage('\uFEFFDate,Amount\n2026-01-01,5.00\n')

    expect(draft.error).toBeNull()
    expect(draft.headers).toEqual(['Date', 'Amount'])
  })

  it('reads a semicolon-separated file', async () => {
    const draft = await stage('Date;Merchant;Amount\n2026-01-01;Acme;-5.00\n')

    expect(draft.error).toBeNull()
    expect(draft.headers).toEqual(['Date', 'Merchant', 'Amount'])
  })
})

describe('surfacing a failure the reader itself could not recover from', () => {
  /**
   * Stands in for a file whose read rejects, since a real File offers no way to make that happen
   */
  function stageUnreadableFile(rejection: unknown) {
    const file = new File(['Date,Amount\n2026-01-01,-5.00\n'], 'statement.csv')
    file.text = () => Promise.reject(rejection)

    return readCsvFile(file, SUPPORTED_CURRENCY_CODES, { requireDataRows: true })
  }

  it('reports the underlying message when reading the file rejects', async () => {
    const draft = await stageUnreadableFile(new Error('boom'))

    expect(draft.error).toBe('Unable to parse CSV: boom')
    expect(draft.rows).toEqual([])
    expect(draft.headers).toEqual([])
  })

  it('falls back to a generic message when the rejection carries no Error', async () => {
    const draft = await stageUnreadableFile('boom')

    expect(draft.error).toBe('Unable to read file')
  })
})

describe('allowing one unreadable character in a file too short for the share rule alone to catch it', () => {
  // Math.floor(19 * 0.05) is 0, which used to refuse a 19-character file outright for a single
  // unreadable character before the share rule could ever apply
  it('stages a 19-character file carrying one replacement character', async () => {
    const draft = await stage('Date,Amount\n2026,\uFFFD\n')

    expect(draft.error).toBeNull()
    expect(draft.notice).toBe('1 character could not be read')
  })

  it('counts more than one replacement character once the file is long enough for the share rule to govern', async () => {
    const draft = await stage(
      'Date,Merchant,Amount\n2026-01-01,Caf\uFFFD Bleu,-5.00\n2026-01-02,Bo\uFFFDte,-6.00\n',
    )

    expect(draft.error).toBeNull()
    expect(draft.notice).toBe('2 characters could not be read')
  })
})

describe('staging a file at exactly the row count it reads', () => {
  it('accepts a file whose data rows equal the row limit', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => `2026-01-01,${index}`)
    const draft = await stage(`Date,Amount\n${rows.join('\n')}\n`)

    expect(draft.error).toBeNull()
  })
})

describe('carrying header detection onto a file actually read', () => {
  it('marks a headerless file with generated column names', async () => {
    // The detection rule itself is covered on the same input elsewhere; what is new here is that
    // reading a real file carries both hasHeaderRow and the generated headers onto the draft
    const draft = await stage('2026-01-01,-5.00\n2026-01-02,-6.00\n')

    expect(draft.hasHeaderRow).toBe(false)
    expect(draft.headers).toEqual(['Column 1', 'Column 2'])
  })
})

describe('creating a fresh id for each read', () => {
  it('gives two reads of the same file different ids, while keeping its name and size', async () => {
    const file = new File(['Date,Amount\n2026-01-01,-5.00\n'], 'statement.csv')

    const first = await readCsvFile(file, SUPPORTED_CURRENCY_CODES, { requireDataRows: true })
    const second = await readCsvFile(file, SUPPORTED_CURRENCY_CODES, { requireDataRows: true })

    expect(first.id).not.toBe(second.id)
    expect(first.name).toBe('statement.csv')
    expect(first.size).toBe(file.size)
  })
})
