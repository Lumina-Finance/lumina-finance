/**
 * Tests the messages a transaction filter's date fields show, so a range over 20 years is refused only
 * where a summary sits above the list, and a date outside the window is refused everywhere
 */
import { describe, expect, it } from 'vitest'
import { getDateRangeErrors } from '@/components/transactions/utils/dateRangeErrors'

// A fixed today, so the ranges below mean the same on every day the suite runs
const TODAY = '2026-06-30'

describe('getDateRangeErrors', () => {
  it('refuses a start with no end on From, saying the range runs up to today', () => {
    expect(getDateRangeErrors({ from: '2000-01-01', to: '' }, TODAY, true)).toEqual({
      from: 'Can cover at most 20 years up to today',
      to: null,
    })
  })

  it('refuses two dates over 20 years apart on To', () => {
    expect(getDateRangeErrors({ from: '2000-01-01', to: '2026-01-01' }, TODAY, true)).toEqual({
      from: null,
      to: 'Can cover at most 20 years',
    })
  })

  it('takes the same dates where no summary sits above the list, as in the refund search', () => {
    expect(getDateRangeErrors({ from: '2000-01-01', to: '' }, TODAY, false)).toEqual({ from: null, to: null })
    expect(getDateRangeErrors({ from: '2000-01-01', to: '2026-01-01' }, TODAY, false)).toEqual({
      from: null,
      to: null,
    })
  })

  it('takes a range within 20 years where a summary sits above the list', () => {
    expect(getDateRangeErrors({ from: '2006-07-01', to: '' }, TODAY, true)).toEqual({ from: null, to: null })
  })

  it('refuses a date before 1900 on its own field whether or not a summary sits above the list', () => {
    for (const checksSummarySpan of [true, false]) {
      expect(getDateRangeErrors({ from: '1899-12-31', to: '' }, TODAY, checksSummarySpan).from).toMatch(
        /^Must be on or after /,
      )
    }
  })
})
