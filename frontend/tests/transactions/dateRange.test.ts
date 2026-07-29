/**
 * Tests the date filter's bounds check, which keeps a from date after the to date from being
 * applied and coming back as an empty list with no reason given
 */
import { describe, expect, it } from 'vitest'
import { isDateRangeCrossed } from '@/pages/transactions/utils/dateRange'

describe('bounds that exclude each other', () => {
  it('reports a from date after the to date', () => {
    expect(isDateRangeCrossed({ from: '2026-07-28', to: '2026-07-27' })).toBe(true)
    expect(isDateRangeCrossed({ from: '2026-08-01', to: '2026-07-31' })).toBe(true)
    expect(isDateRangeCrossed({ from: '2027-01-01', to: '2026-12-31' })).toBe(true)
  })

  it('allows a range in order, including both bounds on the same day', () => {
    expect(isDateRangeCrossed({ from: '2026-07-27', to: '2026-07-28' })).toBe(false)
    expect(isDateRangeCrossed({ from: '2026-07-28', to: '2026-07-28' })).toBe(false)
    expect(isDateRangeCrossed({ from: '2019-02-28', to: '2026-07-28' })).toBe(false)
  })

  it('leaves a bound alone that names no date to compare', () => {
    expect(isDateRangeCrossed({ from: '2026-07-28', to: '' })).toBe(false)
    expect(isDateRangeCrossed({ from: '', to: '2026-07-28' })).toBe(false)
    expect(isDateRangeCrossed({ from: '', to: '' })).toBe(false)
  })
})
