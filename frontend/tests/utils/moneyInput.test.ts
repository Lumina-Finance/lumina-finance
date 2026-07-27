/**
 * Tests the money input layer, which takes an amount in one written form and refuses anything else
 * outright, where the field used to reformat as the user typed and silently change the value
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import {
  fromMinorUnits,
  getCurrencyExponent,
  isAcceptedMoneyInput,
  isValidMoneyInput,
  normalizeMoneyInput,
  readMoneyInputChange,
  toMinorUnits,
} from '@/utils/moneyInput'

const CENTS = 2
const WHOLE_UNITS = 0
const MILS = 3

/**
 * Replays typing the given characters one at a time at the end of the field, keeping whatever the
 * field would have kept after each one
 */
function typeInto(characters: string, exponent = CENTS): string {
  let value = ''
  for (const character of characters) {
    value = readMoneyInputChange(value, value + character, exponent)
  }

  return value
}

describe('what a field takes', () => {
  it('takes whole digits and a decimal point the currency has room for', () => {
    expect(isAcceptedMoneyInput('1234', CENTS)).toBe(true)
    expect(isAcceptedMoneyInput('1234.5', CENTS)).toBe(true)
    expect(isAcceptedMoneyInput('1234.56', CENTS)).toBe(true)
    expect(isAcceptedMoneyInput('1234.', CENTS)).toBe(true)
    expect(isAcceptedMoneyInput('.5', CENTS)).toBe(true)
    expect(isAcceptedMoneyInput('', CENTS)).toBe(true)
  })

  it('refuses more decimals than the currency holds', () => {
    expect(isAcceptedMoneyInput('1234.567', CENTS)).toBe(false)
    expect(isAcceptedMoneyInput('1234.567', MILS)).toBe(true)
  })

  it('refuses a decimal point where the currency has no decimals', () => {
    expect(isAcceptedMoneyInput('1234.', WHOLE_UNITS)).toBe(false)
    expect(isAcceptedMoneyInput('1234.5', WHOLE_UNITS)).toBe(false)
    expect(isAcceptedMoneyInput('1234', WHOLE_UNITS)).toBe(true)
  })

  it('refuses grouping, a second decimal point, a sign and anything that is not a digit', () => {
    expect(isAcceptedMoneyInput('1,234', CENTS)).toBe(false)
    expect(isAcceptedMoneyInput('1 234', CENTS)).toBe(false)
    expect(isAcceptedMoneyInput('1.2.3.4', CENTS)).toBe(false)
    expect(isAcceptedMoneyInput('-1234', CENTS)).toBe(false)
    expect(isAcceptedMoneyInput('$1234', CENTS)).toBe(false)
    expect(isAcceptedMoneyInput('abc', CENTS)).toBe(false)
  })

  it('refuses digits written in another script', () => {
    expect(isAcceptedMoneyInput('١٢٣', CENTS)).toBe(false)
    expect(isAcceptedMoneyInput('１２３', CENTS)).toBe(false)
  })
})

describe('typing an amount', () => {
  it('keeps every keystroke it takes', () => {
    expect(typeInto('12345')).toBe('12345')
    expect(typeInto('1234.56')).toBe('1234.56')
    expect(typeInto('.99')).toBe('.99')
  })

  it('drops a keystroke it will not take, leaving the amount as it was', () => {
    expect(typeInto('1,234')).toBe('1234')
    expect(typeInto('1.2.3.4')).toBe('1.23')
    expect(typeInto('1234.567')).toBe('1234.56')
  })

  it('takes the extra decimal a three-decimal currency holds', () => {
    expect(typeInto('1.234', MILS)).toBe('1.234')
  })

  it('drops the decimal point in a whole-unit currency, so what follows is whole digits', () => {
    expect(typeInto('1000.50', WHOLE_UNITS)).toBe('100050')
  })
})

describe('replacing the whole field', () => {
  it('takes a pasted amount already in the one written form', () => {
    expect(readMoneyInputChange('', '1234.56', CENTS)).toBe('1234.56')
  })

  it('drops a pasted amount carrying anything else, keeping what was there', () => {
    expect(readMoneyInputChange('99', '1,234.56', CENTS)).toBe('99')
    expect(readMoneyInputChange('99', '1.234,56', CENTS)).toBe('99')
    expect(readMoneyInputChange('99', '١٬٢٣٤٫٥٦', CENTS)).toBe('99')
  })
})

describe('converting to and from stored minor units', () => {
  it('scales by the currency decimal places in both directions', () => {
    expect(toMinorUnits('1234.56', CENTS)).toBe(123456)
    expect(toMinorUnits('1234', WHOLE_UNITS)).toBe(1234)
    expect(fromMinorUnits(123456, CENTS)).toBe('1234.56')
    expect(fromMinorUnits(1234, WHOLE_UNITS)).toBe('1234')
  })

  it('moves the decimal point through the digits rather than multiplying', () => {
    expect(toMinorUnits('0.145', MILS)).toBe(145)
    expect(toMinorUnits('1.005', MILS)).toBe(1005)
    expect(toMinorUnits('8.29', CENTS)).toBe(829)
  })

  it('rounds a value left over from a currency that held more decimals', () => {
    expect(toMinorUnits('1.005', CENTS)).toBe(101)
    expect(toMinorUnits('1234.56', WHOLE_UNITS)).toBe(1235)
    expect(toMinorUnits('1234.49', WHOLE_UNITS)).toBe(1234)
  })

  it('pads a short or unfinished decimal out to the currency precision', () => {
    expect(toMinorUnits('1234.5', CENTS)).toBe(123450)
    expect(toMinorUnits('1234.', CENTS)).toBe(123400)
    expect(toMinorUnits('.99', CENTS)).toBe(99)
  })

  it('returns null for a value naming no amount, and an empty string for no amount at all', () => {
    expect(toMinorUnits('', CENTS)).toBeNull()
    expect(toMinorUnits('.', CENTS)).toBeNull()
    expect(fromMinorUnits(null, CENTS)).toBe('')
  })

  it('settles a value to the currency decimal places when the field is left', () => {
    expect(normalizeMoneyInput('1234.5', CENTS)).toBe('1234.50')
    expect(normalizeMoneyInput('.99', CENTS)).toBe('0.99')
    expect(normalizeMoneyInput('007', CENTS)).toBe('7.00')
    expect(normalizeMoneyInput('', CENTS)).toBe('')
  })
})

describe('currency decimal places', () => {
  const currencies = [
    { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
    { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
  ] as Currency[]

  it('reads the exponent from the table, falling back to two', () => {
    expect(getCurrencyExponent(currencies, 'CAD')).toBe(2)
    expect(getCurrencyExponent(currencies, 'JPY')).toBe(0)
    expect(getCurrencyExponent(currencies, 'XXX')).toBe(2)
  })
})

describe('validity', () => {
  it('accepts a blank field and an amount that is not negative', () => {
    expect(isValidMoneyInput('')).toBe(true)
    expect(isValidMoneyInput('1234.56')).toBe(true)
    expect(isValidMoneyInput('0')).toBe(true)
  })

  it('refuses a value naming no number', () => {
    expect(isValidMoneyInput('.')).toBe(false)
  })
})
