/**
 * Tests the import date reader, which resolves a cell into a calendar day under one stated format
 * rather than guessing between readings, and the column scan that decides which formats a file
 * could be read in
 *
 * The property checks the reader's law: a day written in any format, padded or not, with any
 * separator and any spelling of its month, reads as that day when the calendar has it and as nothing
 * when it does not, never as a day it rolls over into. The examples pin 30 February read as nothing, times
 * of day, timestamps, mismatched separators and the spellings the reader refuses
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import { validateColumnValues } from '@/pages/imports/utils'
import {
  IMPORT_DATE_FORMATS,
  type ImportDateFormat,
  type ImportDateSeparator,
  isValidDateValue,
  readImportDate,
  scanImportDateFormats,
} from '@/pages/imports/utils/valueParsers'
import { type CalendarDay, calendarDays, getDaysInUtcMonth, toYmd } from '@tests/utils/generators'

const ALL_FORMATS: ImportDateFormat[] = ['yearFirst', 'dayFirst', 'monthFirst', 'written', 'iso']

const NUMERIC_SEPARATORS = ['-', '/', '.', ':'] as const

const DATE_PROPERTY_RUNS = 1000

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * Draws the parts of a day that may not exist: months and days past their ends, zeros, and February's
 * last days in leap and common years, centuries among them, so both sides of every month's end come up
 *
 * Years start at 1000 so every year is four digits with no leading zero. The reader refuses a year
 * written with a leading zero, and the law allows that, so the pinned examples cover those years
 */
const years = fc.oneof(
  fc.integer({ min: 1000, max: 9999 }),
  fc.integer({ min: 250, max: 2499 }).map((fourYears) => fourYears * 4),
  fc.integer({ min: 10, max: 99 }).map((centuries) => centuries * 100),
)

const dayParts: fc.Arbitrary<CalendarDay> = fc.oneof(
  fc.record({ year: years, month: fc.constant(2), day: fc.integer({ min: 28, max: 30 }) }),
  fc.record({
    year: years,
    month: fc.oneof(fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 99 })),
    day: fc.oneof(fc.integer({ min: 28, max: 32 }), fc.integer({ min: 0, max: 99 })),
  }),
)

/**
 * Reports whether the calendar has a day, worked out apart from the reader
 */
function isRealDay({ year, month, day }: CalendarDay) {
  return month >= 1 && month <= 12 && day >= 1 && day <= getDaysInUtcMonth(year, month)
}

/**
 * Writes a day as a file under one format would, with the separator setting the reading is given
 */
const writtenDays = fc
  .record({
    day: fc.oneof(calendarDays, dayParts),
    format: fc.constantFrom(...IMPORT_DATE_FORMATS),
    separator: fc.constantFrom(...NUMERIC_SEPARATORS),
    isSeparatorRequired: fc.boolean(),
    isPadded: fc.boolean(),
    isCompact: fc.boolean(),
    monthSpelling: fc.constantFrom('name', 'abbreviation', 'abbreviation with period'),
    letterCase: fc.constantFrom('title', 'lower', 'upper'),
    isMonthFirst: fc.boolean(),
    hasComma: fc.boolean(),
  })
  .filter(({ day, format }) => format !== 'written' || (day.month >= 1 && day.month <= 12))
  .map((draw) => {
    const { day, format, separator, isSeparatorRequired, isPadded } = draw
    const setting: ImportDateSeparator = isSeparatorRequired ? separator : 'automatic'
    const year = String(day.year)
    const pad = (part: number) => String(part).padStart(2, '0')
    const month = isPadded ? pad(day.month) : String(day.month)
    const dayOfMonth = isPadded ? pad(day.day) : String(day.day)

    const text = {
      iso: () => `${year}-${pad(day.month)}-${pad(day.day)}`,
      yearFirst: () =>
        draw.isCompact && !isSeparatorRequired
          ? `${year}${pad(day.month)}${pad(day.day)}`
          : `${year}${separator}${month}${separator}${dayOfMonth}`,
      dayFirst: () => `${dayOfMonth}${separator}${month}${separator}${year}`,
      monthFirst: () => `${month}${separator}${dayOfMonth}${separator}${year}`,
      written: () => {
        const fullName = MONTH_NAMES[day.month - 1]
        const spelled = {
          name: fullName,
          abbreviation: fullName.slice(0, 3),
          'abbreviation with period': `${fullName.slice(0, 3)}.`,
        }[draw.monthSpelling]
        const name = { title: spelled, lower: spelled.toLowerCase(), upper: spelled.toUpperCase() }[draw.letterCase]
        const comma = draw.hasComma ? ',' : ''

        return draw.isMonthFirst ? `${name} ${dayOfMonth}${comma} ${year}` : `${dayOfMonth} ${name}${comma} ${year}`
      },
    }[format]()

    return { day, text, format, separator: setting }
  })

// The date column never consults it, so its contents do not matter here
const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])

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
  it('refuses a value whose two separators disagree', () => {
    expect(readImportDate('2024-03/15', 'yearFirst')).toBe('')
    expect(readImportDate('2024/03-15', 'yearFirst')).toBe('')
  })

  it('requires the ISO preset for a timestamp', () => {
    expect(readImportDate('2024-03-15T00:30:00Z', 'yearFirst')).toBe('')
  })
})

describe('dates written with no separators', () => {
  it('refuses eight digits when a separator is required, and under the other orders', () => {
    expect(readImportDate('20260405', 'yearFirst', '-')).toBe('')
    expect(readImportDate('20260405', 'dayFirst')).toBe('')
    expect(readImportDate('20260405', 'iso')).toBe('')
  })

  it('refuses digit runs of any other length', () => {
    expect(readImportDate('2026045', 'yearFirst')).toBe('')
    expect(readImportDate('202604055', 'yearFirst')).toBe('')
  })

  it('leaves exactly one format reading a column of them', () => {
    expect(scanImportDateFormats(['20260405', '20260131']).readable).toEqual(['yearFirst'])
    expect(isValidDateValue('20260405')).toBe(true)
    expect(isValidDateValue('20261340')).toBe(false)
  })
})

describe('dates followed by a time of day', () => {
  it('reads the day written, whatever the time', () => {
    expect(readImportDate('2026.03.01 09:00:00', 'yearFirst')).toBe('2026-03-01')
    expect(readImportDate('2026.03.01 23:59:59', 'yearFirst')).toBe('2026-03-01')
    expect(readImportDate('2026-03-01 9:05', 'yearFirst')).toBe('2026-03-01')
    expect(readImportDate('2026-03-01 09:00:00.250', 'yearFirst')).toBe('2026-03-01')
    expect(readImportDate('20260301 09:00:00', 'yearFirst')).toBe('2026-03-01')
  })

  it('reads a day-first or month-first date with a time', () => {
    expect(readImportDate('05/04/2026 14:32', 'dayFirst')).toBe('2026-04-05')
    expect(readImportDate('04/05/2026 14:32:10', 'monthFirst')).toBe('2026-04-05')
  })

  it('refuses a time no clock shows and a day the calendar does not have', () => {
    expect(readImportDate('2026.03.01 24:00:00', 'yearFirst')).toBe('')
    expect(readImportDate('2026.03.01 09:60:00', 'yearFirst')).toBe('')
    expect(readImportDate('2026.03.01 09:00:60', 'yearFirst')).toBe('')
    expect(readImportDate('2026.02.30 09:00:00', 'yearFirst')).toBe('')
  })

  it('refuses a time with no date, or with more after it', () => {
    expect(readImportDate('09:00:00', 'yearFirst')).toBe('')
    expect(readImportDate('2026.03.01 09:00:00 PM', 'yearFirst')).toBe('')
    expect(readImportDate('2026.03.01 09', 'yearFirst')).toBe('')
  })

  it('keeps a written date and an ISO timestamp as they were read', () => {
    expect(readImportDate('5 April 2026 09:00', 'written')).toBe('')
    expect(readImportDate('2026-03-01 09:00:00', 'iso')).toBe('')
    expect(readImportDate('2026-03-01T09:00:00', 'yearFirst')).toBe('')
    expect(scanImportDateFormats(['2026-03-01T09:00:00']).readable).toEqual(['iso'])
  })

  it('leaves exactly one format reading a column of them', () => {
    const scan = scanImportDateFormats(['2026.03.01 09:00:00', '2026.03.02 10:00:00'])

    expect(scan.readable).toEqual(['yearFirst'])
  })
})

describe('ISO dates and timestamps', () => {
  it.each([
    ['2024-02-29', '2024-02-29'],
    ['2024-03-15T00:30:00', '2024-03-15'],
    ['2024-03-15T00:30:00.123456', '2024-03-15'],
    ['2024-03-15T00:30:00Z', '2024-03-15'],
    ['2024-03-15T00:30:00.123Z', '2024-03-15'],
    ['2024-03-15T00:30:00+09:00', '2024-03-14'],
    ['2024-03-15T23:30:00-04:00', '2024-03-16'],
    ['1899-12-31T23:59:59Z', '1899-12-31'],
    ['2101-01-01', '2101-01-01'],
  ])('reads %s in UTC', (value, expected) => {
    expect(readImportDate(value, 'iso', 'automatic', 'UTC')).toBe(expected)
    expect(readImportDate(value, 'iso', '.', 'UTC')).toBe(expected)
    expect(isValidDateValue(value)).toBe(true)
  })

  it.each([
    ['2024-03-15T00:30:00Z', 'America/Toronto', '2024-03-14'],
    ['2024-03-15T23:30:00-04:00', 'Asia/Tokyo', '2024-03-16'],
    ['2024-01-01T00:30:00Z', 'America/Toronto', '2023-12-31'],
    ['2024-12-31T23:30:00Z', 'Asia/Tokyo', '2025-01-01'],
    ['2024-03-01T00:30:00Z', 'America/Toronto', '2024-02-29'],
    ['2024-03-10T04:30:00Z', 'America/Toronto', '2024-03-09'],
    ['2024-03-11T04:30:00Z', 'America/Toronto', '2024-03-11'],
    ['2024-11-03T04:30:00Z', 'America/Toronto', '2024-11-03'],
    ['2024-11-04T04:30:00Z', 'America/Toronto', '2024-11-03'],
    ['2024-03-15T23:59:59.999999Z', 'UTC', '2024-03-15'],
  ])('converts %s to the calendar day in %s', (value, timeZone, expected) => {
    expect(readImportDate(value, 'iso', 'automatic', timeZone)).toBe(expected)
  })

  it.each(['UTC', 'America/Toronto', 'Asia/Tokyo'])(
    'keeps plain dates and unzoned local timestamps unchanged in %s',
    (timeZone) => {
      for (const value of ['2024-03-10', '2024-03-10T02:30:00', '2024-11-03T01:30:00']) {
        expect(readImportDate(value, 'iso', 'automatic', timeZone)).toBe(value.slice(0, 10))
      }
    },
  )

  it('refuses explicit-offset timestamps without a valid profile timezone', () => {
    for (const timeZone of [undefined, '', 'Invalid/Timezone']) {
      expect(readImportDate('2024-03-15T00:30:00Z', 'iso', 'automatic', timeZone)).toBe('')
    }
    expect(readImportDate('9999-12-31T23:30:00Z', 'iso', 'automatic', 'Asia/Tokyo')).toBe('')
    expect(readImportDate('1000-01-01T00:30:00Z', 'iso', 'automatic', 'America/Toronto')).toBe('')
    expect(readImportDate('0100-01-02T00:30:00Z', 'iso', 'automatic', 'UTC')).toBe('')
  })

  it('uses the same timezone when scanning and validating the selected format', () => {
    const value = '9999-12-31T23:30:00Z'
    expect(scanImportDateFormats([value], 'automatic', 'Asia/Tokyo').readable).toEqual([])
    expect(scanImportDateFormats([value], 'automatic', 'UTC').readable).toEqual(['iso'])
    const files = [createDateFile([value])]
    expect(
      validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'iso', { timeZone: 'Asia/Tokyo' }).valid,
    ).toBe(false)
    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'iso', { timeZone: 'UTC' }).valid).toBe(
      true,
    )
  })

  it('recognizes a source timestamp without imposing a conversion timezone', () => {
    const value = '9999-12-31T23:30:00-05:00'
    expect(isValidDateValue(value)).toBe(true)
    expect(readImportDate(value, 'iso', 'automatic', 'America/New_York')).toBe('9999-12-31')
    expect(readImportDate(value, 'iso', 'automatic', 'UTC')).toBe('')
  })

  it.each([
    '2025-02-29',
    '2024-02-31T00:00:00Z',
    '2024-13-01',
    '2024-00-01',
    '2024-01-00',
    '0099-03-15',
    '2024-3-15',
    '2024/03/15',
    '2024-03-15T24:00:00',
    '2024-03-15T00:60:00',
    '2024-03-15T00:00:60',
    '2024-03-15T00:00:00+25:00',
    '2024-03-15T00:00:00-01:60',
    '2024-03-15T00:00',
    '2024-03-15T00:00:00.',
    '2024-03-15T00:00:00+0900',
    '2024-03-15T00:00:00+09',
    '2024-03-15t00:00:00Z',
    '2024-03-15T00:00:00z',
    '2024-03-15 00:00:00Z',
    '2024-03-15Z',
    '2024-03-15T00:00:00Z junk',
  ])('refuses malformed or impossible ISO values: %s', (value) => {
    expect(readImportDate(value, 'iso', 'automatic', 'UTC')).toBe('')
  })

  it('keeps the ISO example hyphens under a custom numeric separator', () => {
    const result = validateColumnValues(
      [createDateFile(['2024-03-15T24:00:00Z'])],
      'Date',
      'dt',
      SUPPORTED_CURRENCY_CODES,
      'iso',
      { dateSeparator: '.' },
    )
    expect(result.valid).toBe(false)
    expect(result.message).toContain('such as 2026-04-30T12:00:00Z')
  })
})

describe('numeric dates in a stated order', () => {
  it('can require one selected separator', () => {
    expect(readImportDate('31.08.2026', 'dayFirst', '.')).toBe('2026-08-31')
    expect(readImportDate('31/08/2026', 'dayFirst', '.')).toBe('')
    expect(readImportDate('31-08-2026', 'dayFirst', '.')).toBe('')
  })

  it('requires a four-digit year, so the century is never guessed', () => {
    expect(readImportDate('15/03/24', 'dayFirst')).toBe('')
    expect(readImportDate('15/03/95', 'dayFirst')).toBe('')
    expect(readImportDate('03/15/24', 'monthFirst')).toBe('')
  })
})

describe('written dates', () => {
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
  it('reads 30 February as nothing, never as 2 March', () => {
    expect(readImportDate('2026-02-30', 'yearFirst')).toBe('')
    expect(readImportDate('2026-02-30', 'iso')).toBe('')
  })

  it('reads any day written in any format as that day when the calendar has it, and as nothing otherwise', () => {
    fc.assert(
      fc.property(writtenDays, ({ day, text, format, separator }) => {
        expect(readImportDate(text, format, separator)).toBe(isRealDay(day) ? toYmd(day) : '')
      }),
      // Five formats, several spellings and both sides of each month's end share the draws, so the
      // default hundred runs would meet each combination only by chance
      { numRuns: DATE_PROPERTY_RUNS },
    )
  })

  it('refuses a year the date constructor would silently move into the 1900s', () => {
    expect(readImportDate('0099-03-15', 'yearFirst')).toBe('')
    expect(readImportDate('0001-03-15', 'yearFirst')).toBe('')
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

  it('accepts different supported separators under automatic selection', () => {
    const scan = scanImportDateFormats(['2026/08/30', '2026-08-31'])

    expect(scan.readable).toEqual(['yearFirst'])
  })

  it('rules out values that do not use the required custom separator', () => {
    const scan = scanImportDateFormats(['2026/08/30', '2026-08-31'], '.')

    expect(scan.readable).toEqual([])
    expect(scan.rejectedBy.yearFirst).toBe('2026/08/30')
  })

  it('ignores blank cells, which the required-value check reports on its own', () => {
    const scan = scanImportDateFormats(['2024-03-15', '', '   ', '2024-04-01'])

    expect(scan.readable).toEqual(['yearFirst', 'iso'])
  })
})

describe('validating a date column', () => {
  it('accepts a column that could be read some way when no format is settled yet', () => {
    const files = [createDateFile(['15/03/2024', '2024-03-15'])]

    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES).valid).toBe(true)
  })

  it('refuses the same column once a format is chosen, naming the value that broke it', () => {
    const files = [createDateFile(['15/03/2024', '2024-03-15'])]

    const result = validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'dayFirst')

    expect(result.valid).toBe(false)
    expect(result.message).toContain('2024-03-15')
    expect(result.message).toContain('30/04/2026')
  })

  // A day no format reads says nothing about which format the file is in, so only its row is left out
  it('takes a column holding a day the calendar does not have, leaving that row to be judged on its own', () => {
    const files = [createDateFile(['2024-03-15', '2024-02-31'])]

    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'yearFirst').valid).toBe(true)
  })

  it('accepts a column that reads all the way through in the chosen format', () => {
    const files = [createDateFile(['15/03/2024', '02/04/2024'])]

    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'dayFirst').valid).toBe(true)
  })

  it('refuses a two-digit year that used to import as this century', () => {
    const files = [createDateFile(['15/03/24'])]

    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'dayFirst').valid).toBe(false)
  })

  it('names the written format in sentence case, without repeating the word', () => {
    const files = [createDateFile(['July 4th, 2024'])]

    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'written').message).toBe(
      'Expected valid dates in the written format, such as April 30, 2026. Row 1 has "July 4th, 2024", which is not a valid date.',
    )
  })

  it('names every format in sentence case', () => {
    const files = [createDateFile(['nonsense'])]
    const named = (format: ImportDateFormat) =>
      validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, format).message

    expect(named('yearFirst')).toContain('in the year first format, such as 2026-04-30')
    expect(named('dayFirst')).toContain('in the day first format, such as 30/04/2026')
    expect(named('monthFirst')).toContain('in the month first format, such as 04/30/2026')
    expect(named('written')).toContain('in the written format, such as April 30, 2026')
  })

  it('keeps the capitals of ISO in the name of its format', () => {
    const files = [createDateFile(['nonsense'])]

    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'iso').message).toContain(
      'in the ISO date/time format, such as 2026-04-30T12:00:00Z',
    )
  })

  it('accepts a real date whatever century it falls in', () => {
    const files = [createDateFile(['1899-12-31'])]

    expect(validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'yearFirst').valid).toBe(true)
  })

  it('does not blame the shape when the value is that shape but names no real day', () => {
    const files = [createDateFile(['2024-02-31'])]

    const result = validateColumnValues(files, 'Date', 'dt', SUPPORTED_CURRENCY_CODES, 'yearFirst')

    expect(result.valid).toBe(false)
    expect(result.message).toContain('Row 1 has "2024-02-31", which is not a valid date')
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
