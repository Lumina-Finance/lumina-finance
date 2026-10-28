/**
 * Tests the shared list formatter that every displayed list goes through
 */
import { describe, expect, it } from 'vitest'
import { formatList, formatValueList } from '@/utils/formatList'

describe('formatList', () => {
  it('reads one, two and three items the way a sentence does', () => {
    expect(formatList([])).toBe('')
    expect(formatList(['Food'])).toBe('Food')
    expect(formatList(['Food', 'Rent'])).toBe('Food and Rent')
    expect(formatList(['Food', 'Rent', 'Fun'])).toBe('Food, Rent and Fun')
  })
})

describe('formatValueList', () => {
  it('separates values with no word before the last one', () => {
    expect(formatValueList([])).toBe('')
    expect(formatValueList(['CAD'])).toBe('CAD')
    expect(formatValueList(['CAD', 'USD', 'EUR'])).toBe('CAD, USD, EUR')
  })
})
