/**
 * Tests the budget money conversion, so a typed amount reaches the API in the right minor units and a
 * currency the table does not carry yields no amount rather than a guessed one
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { toMinorUnits } from '@/pages/budgets/utils/money'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

describe('budget money helpers', () => {
  it('converts between decimal inputs and currency minor units', () => {
    expect(toMinorUnits('1234.56', currencies, 'CAD')).toBe(123456)
    expect(toMinorUnits('1234.56', currencies, 'JPY')).toBe(1235)
    expect(toMinorUnits('0', currencies, 'CAD')).toBeNull()
  })

  it('reads no amount from the blank limit a missing currency table leaves behind', () => {
    // The edit form treats this null as no change, so a period keeps the limit the user was never shown
    expect(toMinorUnits('', [], 'JPY')).toBeNull()
  })
})
