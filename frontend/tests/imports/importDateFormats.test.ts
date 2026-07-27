/**
 * Tests the import date reader, which resolves a cell into a calendar day under one stated format
 * rather than guessing between readings, and the column scan that decides which formats a file
 * could be read in
 */
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import { validateColumnValues } from '@/pages/imports/utils'
import {
  type ImportDateFormat,
  isValidDateValue,
  readImportDate,
  scanImportDateFormats,
} from '@/pages/imports/utils/valueParsers'

const ALL_FORMATS: ImportDateFormat[] = ['yearFirst', 'dayFirst', 'monthFirst', 'written']

/**
 * Creates a one-column file whose every row holds the given date
 */
function createDateFile(dates: string[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Checking.csv',
    size: 512,
    headers: ['Date'],
    hasHeaderRow: true,
    rows: dates.map((date) => ({ Date: date })),
    error: null,
  }
}

describe('year first dates', () => {
  it('reads a date with either separator, padded or not', () => {
    expect(readImportDate('2024-03-15', 'yearFirst')).toBe('2024-03-15')
    expect(readImportDate('2024-3-15', 'yearFirst')).toBe('2024-03-15')
    expect(readImportDate('2024-3-5', 'yearFirst')).toBe('2024-03-05')
    expect(readImportDate('2024/03/15', 'yearFirst')).toBe('2024-03-15')
  })

  it('refuses a value whose two separators disagree', () => {
    expect(readImportDate('2024-03/15', 'yearFirst')).toBe('')
    expect(readImportDate('2024/03-15', 'yearFirst')).toBe('')
  })

  it('refuses a timestamp, which used to import a day early west of Greenwich', () => {
    expect(readImportDate('2024-03-15T00:30:00Z', 'yearFirst')).toBe('')
  })
})

describe('numeric dates in a stated order', () => {
  it('reads the same value as two different days depending on the order', () => {
    expect(readImportDate('03/04/2024', 'dayFirst')).toBe('2024-04-03')
    expect(readImportDate('03/04/2024', 'monthFirst')).toBe('2024-03-04')
  })

  it('never falls back to the other order when the stated one does not fit', () => {
    expect(readImportDate('13/04/2024', 'monthFirst')).toBe('')
    expect(readImportDate('04/13/2024', 'dayFirst')).toBe('')
  })

  it('accepts an unpadded part and either separator', () => {
    expect(readImportDate('5/3/2024', 'dayFirst')).toBe('2024-03-05')
    expect(readImportDate('15-03-2024', 'dayFirst')).toBe('2024-03-15')
  })

  it('requires a four-digit year, so the century is never guessed', () => {
    expect(readImportDate('15/03/24', 'dayFirst')).toBe('')
    expect(readImportDate('15/03/95', 'dayFirst')).toBe('')
    expect(readImportDate('03/15/24', 'monthFirst')).toBe('')
  })
})

describe('written dates', () => {
  it('reads the month name on either side of the day', () => {
    expect(readImportDate('July 4, 2024', 'written')).toBe('2024-07-04')
    expect(readImportDate('July 4 2024', 'written')).toBe('2024-07-04')
    expect(readImportDate('4 July, 2024', 'written')).toBe('2024-07-04')
    expect(readImportDate('4 July 2024', 'written')).toBe('2024-07-04')
  })

  it('reads a three-letter abbreviation, with or without its period', () => {
    expect(readImportDate('Jul 4, 2024', 'written')).toBe('2024-07-04')
    expect(readImportDate('Jul. 4, 2024', 'written')).toBe('2024-07-04')
    expect(readImportDate('4 Jul, 2024', 'written')).toBe('2024-07-04')
  })

  it('ignores case and a leading zero on the day', () => {
    expect(readImportDate('jul 4 2024', 'written')).toBe('2024-07-04')
    expect(readImportDate('JULY 4, 2024', 'written')).toBe('2024-07-04')
    expect(readImportDate('04 jul 2024', 'written')).toBe('2024-07-04')
  })

  it('refuses an ordinal suffix', () => {
    expect(readImportDate('July 4th, 2024', 'written')).toBe('')
    expect(readImportDate('1st July 2024', 'written')).toBe('')
  })

  it('refuses a four-letter abbreviation and a word that names no month', () => {
    expect(readImportDate('Sept 4, 2024', 'written')).toBe('')
    expect(readImportDate('Smarch 4, 2024', 'written')).toBe('')
  })

  it('refuses a month named in another language', () => {
    expect(readImportDate('juillet 4, 2024', 'written')).toBe('')
    expect(readImportDate('4 mars 2024', 'written')).toBe('')
    expect(readImportDate('4 März 2024', 'written')).toBe('')
  })

  it('refuses a two-digit year', () => {
    expect(readImportDate('Jul 4, 24', 'written')).toBe('')
  })

  it('reads May, whose name and abbreviation are the same word', () => {
    expect(readImportDate('May 4, 2024', 'written')).toBe('2024-05-04')
  })
})

describe('days the calendar does not have', () => {
  it('refuses them in every format', () => {
    expect(readImportDate('2024-02-31', 'yearFirst')).toBe('')
    expect(readImportDate('31/02/2024', 'dayFirst')).toBe('')
    expect(readImportDate('02/31/2024', 'monthFirst')).toBe('')
    expect(readImportDate('February 31, 2024', 'written')).toBe('')
    expect(readImportDate('2025-02-29', 'yearFirst')).toBe('')
  })

  it('keeps the leap day of a leap year', () => {
    expect(readImportDate('29/02/2024', 'dayFirst')).toBe('2024-02-29')
  })

  it('refuses a year far enough out to be a typo', () => {
    expect(readImportDate('1899-03-15', 'yearFirst')).toBe('')
    expect(readImportDate('2101-03-15', 'yearFirst')).toBe('')
  })
})

describe('blank and unreadable cells', () => {
  it('reads as nothing in every format', () => {
    for (const format of ALL_FORMATS) {
      expect(readImportDate('', format)).toBe('')
      expect(readImportDate('   ', format)).toBe('')
      expect(readImportDate('2024', format)).toBe('')
      expect(readImportDate('not a date', format)).toBe('')
    }
  })

  it('refuses digits that are not Latin, which some keypads emit', () => {
    for (const format of ALL_FORMATS) {
      expect(readImportDate('٢٠٢٤-٠٣-١٥', format)).toBe('')
      expect(readImportDate('２０２４-０３-１５', format)).toBe('')
    }
  })
})

describe('scanning a column', () => {
  it('leaves one format standing when a value rules the others out', () => {
    const scan = scanImportDateFormats(['15/03/2024', '02/04/2024'])

    expect(scan.readable).toEqual(['dayFirst'])
    expect(scan.rejectedBy.monthFirst).toBe('15/03/2024')
    expect(scan.rejectedBy.yearFirst).toBe('15/03/2024')
  })

  it('leaves both orders standing when every day could also be a month', () => {
    const scan = scanImportDateFormats(['03/04/2024', '05/06/2024'])

    expect(scan.readable).toEqual(['dayFirst', 'monthFirst'])
  })

  it('rules every format out when the column changes format part way through', () => {
    const scan = scanImportDateFormats(['2024-03-15', '15/03/2024'])

    expect(scan.readable).toEqual([])
    expect(scan.rejectedBy.yearFirst).toBe('15/03/2024')
    expect(scan.rejectedBy.dayFirst).toBe('2024-03-15')
  })

  it('ignores blank cells, which the required-value check reports on its own', () => {
    const scan = scanImportDateFormats(['2024-03-15', '', '   ', '2024-04-01'])

    expect(scan.readable).toEqual(['yearFirst'])
  })
})

describe('validating a date column', () => {
  it('accepts a column that could be read some way when no format is settled yet', () => {
    const files = [createDateFile(['15/03/2024', '2024-03-15'])]

    expect(validateColumnValues(files, 'Date', 'dt').valid).toBe(true)
  })

  it('refuses the same column once a format is chosen, naming the value that broke it', () => {
    const files = [createDateFile(['15/03/2024', '2024-03-15'])]

    const result = validateColumnValues(files, 'Date', 'dt', 'dayFirst')

    expect(result.valid).toBe(false)
    expect(result.message).toContain('2024-03-15')
    expect(result.message).toContain('30/04/2026')
  })

  it('accepts a column that reads all the way through in the chosen format', () => {
    const files = [createDateFile(['15/03/2024', '02/04/2024'])]

    expect(validateColumnValues(files, 'Date', 'dt', 'dayFirst').valid).toBe(true)
  })

  it('refuses a two-digit year that used to import as this century', () => {
    const files = [createDateFile(['15/03/24'])]

    expect(validateColumnValues(files, 'Date', 'dt', 'dayFirst').valid).toBe(false)
  })

  it('names the written format in sentence case, without repeating the word', () => {
    const files = [createDateFile(['July 4th, 2024'])]

    expect(validateColumnValues(files, 'Date', 'dt', 'written').message)
      .toBe('Expected valid dates in the written format, such as April 30, 2026; every row must have a value. "July 4th, 2024" is not a valid date.')
  })

  it('lowers every other format name the same way', () => {
    const files = [createDateFile(['2024-13-01'])]

    expect(validateColumnValues(files, 'Date', 'dt', 'yearFirst').message)
      .toContain('valid dates in the year first format, such as 2026-04-30')
  })

  it('does not blame the shape when the value is that shape but names no real day', () => {
    const files = [createDateFile(['2024-02-31'])]

    const result = validateColumnValues(files, 'Date', 'dt', 'yearFirst')

    expect(result.valid).toBe(false)
    expect(result.message).toContain('"2024-02-31" is not a valid date')
    expect(result.message).not.toContain('does not match')
  })
})

describe('isValidDateValue', () => {
  it('accepts a value that reads under any one format', () => {
    expect(isValidDateValue('2024-03-15')).toBe(true)
    expect(isValidDateValue('15/03/2024')).toBe(true)
    expect(isValidDateValue('4 Jul, 2024')).toBe(true)
  })

  it('refuses a bare year, which the browser would have read as a date', () => {
    expect(isValidDateValue('2024')).toBe(false)
  })

  it('refuses a blank cell', () => {
    expect(isValidDateValue('')).toBe(false)
  })
})
