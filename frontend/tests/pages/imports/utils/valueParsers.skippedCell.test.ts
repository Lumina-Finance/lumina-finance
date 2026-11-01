/**
 * Tests that the skipped table writes out a bounded part of a refused row's cell, so a row refused
 * for a tag name of 100,000 characters does not put all of it on the page
 */
import { describe, expect, it } from 'vitest'
import { SKIPPED_TABLE_CELL_DISPLAY_LIMIT } from '@/pages/imports/constants'
import { clipSkippedCellValue } from '@/pages/imports/utils/valueParsers'

describe("clipping a refused row's cell", () => {
  it('leaves a cell at or under the limit as it is', () => {
    const atLimit = 'a'.repeat(SKIPPED_TABLE_CELL_DISPLAY_LIMIT)

    expect(clipSkippedCellValue(atLimit)).toBe(atLimit)
    expect(clipSkippedCellValue('')).toBe('')
  })

  it.each([SKIPPED_TABLE_CELL_DISPLAY_LIMIT + 1, 257, 100_000])(
    'cuts a cell of %i characters and says so',
    (length) => {
      const clipped = clipSkippedCellValue('a'.repeat(length))

      expect(clipped).toBe(`${'a'.repeat(SKIPPED_TABLE_CELL_DISPLAY_LIMIT)}…`)
    },
  )

  it('counts characters rather than UTF-16 units, and never splits a symbol', () => {
    const symbols = '😀'.repeat(SKIPPED_TABLE_CELL_DISPLAY_LIMIT)

    expect(clipSkippedCellValue(symbols)).toBe(symbols)
    expect(clipSkippedCellValue(`${symbols}😀`)).toBe(`${symbols}…`)
  })
})
