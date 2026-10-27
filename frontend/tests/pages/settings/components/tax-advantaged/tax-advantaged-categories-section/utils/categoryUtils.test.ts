/**
 * Tests the tax-advantaged category currency helpers, so the dropdown labels a currency as every other
 * currency dropdown does and the limit field's symbol is the one the reader's language writes
 *
 * The test script pins the suite to en-US through LC_ALL, so a Canadian dollar reads CA$ below
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import {
  currencyOptions,
  currencySymbol,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

describe('tax-advantaged category currency helpers', () => {
  it('labels each currency with its code, name and the reader\'s symbol', () => {
    expect(currencyOptions(currencies)).toEqual([{ value: 'CAD', label: 'CAD · Canadian Dollar (CA$)' }])
  })

  it('writes a loaded currency\'s symbol the way the reader\'s language does and none for an unknown code', () => {
    expect(currencySymbol(currencies, 'CAD')).toBe('CA$')
    expect(currencySymbol(currencies, 'EUR')).toBe('')
  })
})
