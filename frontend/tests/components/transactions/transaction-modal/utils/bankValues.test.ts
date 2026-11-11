/**
 * Guards which fields of a bank-imported transaction show the bank's value under them: only the
 * fields the server counts as edited, the amount signed as a moved amount in the transaction's
 * currency, an amount the bank sent that the currency can't hold shown exactly as sent with the reason
 * it can't be restored, and nothing for a transaction entered by hand
 */
import { describe, expect, it } from 'vitest'
import { getBankValueCaptions } from '@/components/transactions/transaction-modal/utils/bankValues'
import { BANK_SOURCE, currencies } from './fixtures'

const MINUS = String.fromCodePoint(0x2212)

describe('bank value captions', () => {
  it('show nothing on a transaction whose fields all still match the bank', () => {
    expect(getBankValueCaptions(BANK_SOURCE, 'CAD', currencies)).toEqual({ date: null, amount: null })
  })

  it('show the bank amount, signed, under an edited amount only', () => {
    const source = { ...BANK_SOURCE, edited_fields: ['amount' as const] }

    expect(getBankValueCaptions(source, 'CAD', currencies)).toEqual({
      date: null,
      amount: { value: `${MINUS}CA$42.50`, unavailableReason: null },
    })
  })

  it('show the bank date under an edited date only', () => {
    const source = { ...BANK_SOURCE, edited_fields: ['date' as const] }

    expect(getBankValueCaptions(source, 'CAD', currencies)).toEqual({
      date: { value: 'Jul 12, 2026', unavailableReason: null },
      amount: null,
    })
  })

  it('show both bank values when both fields are edited, money coming in with a plus in the transaction currency', () => {
    const source = {
      ...BANK_SOURCE,
      bank_values: { ...BANK_SOURCE.bank_values, amount: 500 },
      edited_fields: ['date' as const, 'amount' as const],
    }

    expect(getBankValueCaptions(source, 'JPY', currencies)).toEqual({
      date: { value: 'Jul 12, 2026', unavailableReason: null },
      amount: { value: '+¥500', unavailableReason: null },
    })
  })

  it("show an amount the bank sent with more decimal places than the currency holds exactly as sent, saying why it can't be restored", () => {
    const source = {
      ...BANK_SOURCE,
      bank_values: { ...BANK_SOURCE.bank_values, amount: null, raw_amount: '-42.505' },
      edited_fields: ['amount' as const],
    }

    expect(getBankValueCaptions(source, 'CAD', currencies)).toEqual({
      date: null,
      amount: {
        value: `${MINUS}CA$42.505`,
        unavailableReason: "The bank's amount has more decimal places than CAD allows, so the amount can't be restored",
      },
    })
  })

  it('show nothing on a transaction entered by hand', () => {
    expect(getBankValueCaptions(null, 'CAD', currencies)).toEqual({ date: null, amount: null })
  })
})
