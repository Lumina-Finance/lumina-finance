/**
 * Tests the transaction modal money handling, so the amount a user types, the sign it carries and the
 * stored minor units it is read back from cannot drift from the currency it belongs to
 */
import { describe, expect, it } from 'vitest'
import {
  amountInputToMinorUnits,
  amountToInputString,
  applyTransactionDirection,
  findAmountInputString,
  getDirectionFromAmountInputSign,
} from '@/pages/transactions/components/transaction-modal/utils/money'
import { currencies } from './fixtures'

describe('transaction modal money helpers', () => {
  it('keeps money conversion and sign-derived direction aligned with backend minor units', () => {
    expect(getDirectionFromAmountInputSign('+12-34')).toBe('debit')
    expect(amountToInputString(-12345, 2)).toBe('123.45')
    expect(amountInputToMinorUnits('123.45', 2)).toBe(12345)
    expect(applyTransactionDirection(12345, 'credit')).toBe(12345)
    expect(applyTransactionDirection(12345, 'debit')).toBe(-12345)
  })

  it('reads a stored amount back through its own currency and refuses one it cannot scale', () => {
    // The modal fills its amount box from this when the currency table lands under an open modal,
    // so a wrong answer here is a wrong amount shown over a transaction the user is about to save
    expect(findAmountInputString(1234, currencies, 'CAD')).toBe('12.34')
    expect(findAmountInputString(1234, currencies, 'JPY')).toBe('1234')
    expect(findAmountInputString(-1234, currencies, 'CAD')).toBe('12.34')

    // No table yet, and a currency the table does not carry, are the same answer: the amount cannot
    // be turned into text, so nothing is offered rather than a figure scaled by the two-place default
    expect(findAmountInputString(1234, [], 'JPY')).toBeNull()
    expect(findAmountInputString(1234, currencies, 'KRW')).toBeNull()
  })
})
