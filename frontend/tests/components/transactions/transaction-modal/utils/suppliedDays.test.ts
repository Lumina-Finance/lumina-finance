/**
 * Guards the days the transaction modal refuses because a linked account's bank supplies them, so a
 * manual entry can't duplicate a bank transaction, while an edit that dates nothing anew, a
 * bank-imported transaction's own date and every day outside the range stay open
 */
import { describe, expect, it } from 'vitest'
import { INITIAL_TRANSACTION_FORM } from '@/components/transactions/transaction-modal/constants'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'
import { getSuppliedDays } from '@/components/transactions/transaction-modal/utils/suppliedDays'
import { BANK_SOURCE, createAccount, createTransaction } from './fixtures'

const TODAY = '2026-10-04'
const EVERYDAY = createAccount({ id: 'everyday', name: 'Everyday' })
const SAVINGS = createAccount({ id: 'savings', name: 'Savings' })
const VISA = createAccount({ id: 'visa', name: 'Visa' })
const LINKS = new Map([
  [EVERYDAY.id, { provider_name: 'SimpleFIN', import_start: '2026-06-01' }],
  [VISA.id, { provider_name: 'SimpleFIN', import_start: '2026-09-01' }],
])
const EVERYDAY_MESSAGE = "SimpleFIN supplies this account's transactions from Jun 1, 2026 to today"

function form(overrides: Partial<TransactionFormValues>): TransactionFormValues {
  return { ...INITIAL_TRANSACTION_FORM, account_id: EVERYDAY.id, ...overrides }
}

describe('days a linked account’s bank supplies', () => {
  it.each([
    ['the day before the import start', '2026-05-31', null],
    ['the import start', '2026-06-01', EVERYDAY_MESSAGE],
    ['today', TODAY, EVERYDAY_MESSAGE],
    ['tomorrow', '2026-10-05', null],
  ])('treats %s alike in the date and the calendar', (_, date, message) => {
    const days = getSuppliedDays({ form: form({ date }), counterpartyAccount: undefined, linksByAccount: LINKS, today: TODAY })

    expect(days.message).toBe(message)
    expect(days.isDateDisabled?.(date)).toBe(message !== null)
  })

  it('leaves an account without a link alone', () => {
    const days = getSuppliedDays({
      form: form({ account_id: SAVINGS.id, date: '2026-07-12' }),
      counterpartyAccount: undefined,
      linksByAccount: LINKS,
      today: TODAY,
    })

    expect(days).toEqual({ isDateDisabled: undefined, message: null })
  })

  it('lets an edit keep an in-range date and account, and checks a changed date', () => {
    const transaction = createTransaction({ account_id: EVERYDAY.id, dt: '2026-06-15' })
    const check = (date: string) =>
      getSuppliedDays({ form: form({ date }), transaction, counterpartyAccount: undefined, linksByAccount: LINKS, today: TODAY })

    expect(check('2026-06-15').message).toBeNull()
    expect(check('2026-06-16').message).toBe(EVERYDAY_MESSAGE)
  })

  it('checks a transaction moved into the linked account on the date it keeps', () => {
    const transaction = createTransaction({ account_id: SAVINGS.id, dt: '2026-07-12' })

    const days = getSuppliedDays({
      form: form({ date: '2026-07-12' }),
      transaction,
      counterpartyAccount: undefined,
      linksByAccount: LINKS,
      today: TODAY,
    })

    expect(days.message).toBe(EVERYDAY_MESSAGE)
  })

  it('leaves a bank-imported transaction’s date to the bank while it stays in its account', () => {
    const transaction = createTransaction({ account_id: EVERYDAY.id, dt: '2026-07-12', bank_source: BANK_SOURCE })

    const days = getSuppliedDays({
      form: form({ date: '2026-07-13' }),
      transaction,
      counterpartyAccount: undefined,
      linksByAccount: LINKS,
      today: TODAY,
    })

    expect(days).toEqual({ isDateDisabled: undefined, message: null })
  })

  it('checks a bank-imported transaction moving out of an account no longer linked, and not one leaving a linked account', () => {
    const movedTo = (from: string) => getSuppliedDays({
      form: form({ date: '2026-07-12' }),
      transaction: createTransaction({ account_id: from, dt: '2026-07-12', bank_source: BANK_SOURCE }),
      counterpartyAccount: undefined,
      linksByAccount: LINKS,
      today: TODAY,
    })

    // Leaving a linked account is refused on the account field for the move itself, whatever the date
    expect(movedTo(SAVINGS.id).message).toBe(EVERYDAY_MESSAGE)
    expect(movedTo(VISA.id).message).toBeNull()
  })

  it('checks the other account of a new symmetric transfer, naming it', () => {
    const transfer = (symmetric_transfer: boolean) => getSuppliedDays({
      form: form({
        kind: 'transfer',
        account_id: SAVINGS.id,
        counterparty_account_id: VISA.id,
        symmetric_transfer,
        date: '2026-09-15',
      }),
      counterpartyAccount: VISA,
      linksByAccount: LINKS,
      today: TODAY,
    })

    expect(transfer(true).message).toBe('SimpleFIN supplies the transactions in Visa from Sep 1, 2026 to today')
    expect(transfer(true).isDateDisabled?.('2026-09-15')).toBe(true)
    expect(transfer(false)).toEqual({ isDateDisabled: undefined, message: null })
  })

  it('leaves the other account alone when a transfer is edited, since only the one transaction changes', () => {
    const days = getSuppliedDays({
      form: form({
        kind: 'transfer',
        account_id: SAVINGS.id,
        counterparty_account_id: VISA.id,
        symmetric_transfer: true,
        date: '2026-09-15',
      }),
      transaction: createTransaction({ account_id: SAVINGS.id, dt: '2026-08-20' }),
      counterpartyAccount: VISA,
      linksByAccount: LINKS,
      today: TODAY,
    })

    expect(days).toEqual({ isDateDisabled: undefined, message: null })
  })
})
