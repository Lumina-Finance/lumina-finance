/**
 * Guards the days the transaction modal refuses because a linked account's bank supplies them, so a
 * manual entry can't duplicate a bank transaction, while an edit that dates nothing anew, a
 * bank-imported transaction's own date and every day outside the range stay open
 */
import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/api/transactions'
import { INITIAL_TRANSACTION_FORM } from '@/components/transactions/transaction-modal/constants'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'
import { getSuppliedDays, type SuppliedDays } from '@/components/transactions/transaction-modal/utils/suppliedDays'
import { BANK_SOURCE, createAccount, createTransaction } from './fixtures'

const TODAY = '2026-10-04'
const EVERYDAY = createAccount({ id: 'everyday', name: 'Everyday' })
const SAVINGS = createAccount({ id: 'savings', name: 'Savings' })
const VISA = createAccount({ id: 'visa', name: 'Visa' })
const ACCOUNTS = [EVERYDAY, SAVINGS, VISA]
const LINKS = new Map([
  [EVERYDAY.id, { provider_name: 'SimpleFIN', import_start: '2026-06-01' }],
  [VISA.id, { provider_name: 'SimpleFIN', import_start: '2026-09-01' }],
])

/**
 * Writes a date as the message does, with non-breaking spaces, so a narrow field never wraps it
 * between its month and its day
 */
function unbroken(date: string): string {
  return date.replaceAll(' ', ' ')
}

const EVERYDAY_MESSAGE = `SimpleFIN supplies this account's transactions from ${unbroken('Jun 1, 2026')} to today`

/**
 * Works out the refused days for a form recorded in Everyday unless it says otherwise, finding its
 * accounts by id as the modal does
 */
function check(overrides: Partial<TransactionFormValues>, transaction?: Transaction): SuppliedDays {
  const form = { ...INITIAL_TRANSACTION_FORM, account_id: EVERYDAY.id, ...overrides }
  const findAccount = (id: string | null) => ACCOUNTS.find((account) => account.id === id)
  return getSuppliedDays({
    form,
    transaction,
    recordedAccount: findAccount(form.account_id),
    counterpartyAccount: findAccount(form.counterparty_account_id),
    linksByAccount: LINKS,
    today: TODAY,
  })
}

function expectNothingRefused(days: SuppliedDays) {
  expect(days.message).toBeNull()
  expect(days.isDateDisabled).toBeFalsy()
}

// A new transfer recorded in both accounts
function pair(accountId: string, counterpartyAccountId: string, date: string, symmetric_transfer = true) {
  return check({
    kind: 'transfer',
    account_id: accountId,
    counterparty_account_id: counterpartyAccountId,
    symmetric_transfer,
    date,
  })
}

describe('days a linked account’s bank supplies', () => {
  it.each([
    ['the day before the import start', '2026-05-31', null],
    ['the import start', '2026-06-01', EVERYDAY_MESSAGE],
    ['today', TODAY, EVERYDAY_MESSAGE],
    ['tomorrow', '2026-10-05', null],
  ])('treats %s alike in the date and the calendar', (_, date, message) => {
    const days = check({ date })

    expect(days.message).toBe(message)
    expect(days.isDateDisabled?.(date)).toBe(message !== null)
  })

  it('leaves an account without a link alone', () => {
    expectNothingRefused(check({ account_id: SAVINGS.id, date: '2026-07-12' }))
  })

  it('lets an edit keep an in-range date and account, and checks a changed date', () => {
    const transaction = createTransaction({ account_id: EVERYDAY.id, dt: '2026-06-15' })

    expect(check({ date: '2026-06-15' }, transaction).message).toBeNull()
    expect(check({ date: '2026-06-16' }, transaction).message).toBe(EVERYDAY_MESSAGE)
  })

  it('checks a transaction moved into the linked account on the date it keeps', () => {
    const transaction = createTransaction({ account_id: SAVINGS.id, dt: '2026-07-12' })

    expect(check({ date: '2026-07-12' }, transaction).message).toBe(EVERYDAY_MESSAGE)
  })

  it('leaves a bank-imported transaction’s date to the bank while it stays in its account', () => {
    const transaction = createTransaction({ account_id: EVERYDAY.id, dt: '2026-07-12', bank_source: BANK_SOURCE })

    expectNothingRefused(check({ date: '2026-07-13' }, transaction))
  })

  it('checks a bank-imported transaction moving out of an account no longer linked, and not one leaving a linked account', () => {
    const movedFrom = (from: string) =>
      check({ date: '2026-07-12' }, createTransaction({ account_id: from, dt: '2026-07-12', bank_source: BANK_SOURCE }))

    // Leaving a linked account is refused on the account field for the move itself, whatever the date
    expect(movedFrom(SAVINGS.id).message).toBe(EVERYDAY_MESSAGE)
    expect(movedFrom(VISA.id).message).toBeNull()
  })

  it('checks the other account of a new symmetric transfer, naming it', () => {
    const days = pair(SAVINGS.id, VISA.id, '2026-09-15')

    expect(days.message).toBe(`SimpleFIN supplies the transactions in Visa from ${unbroken('Sep 1, 2026')} to today`)
    expect(days.isDateDisabled?.('2026-09-15')).toBe(true)
    expectNothingRefused(pair(SAVINGS.id, VISA.id, '2026-09-15', false))
  })

  it('checks both linked accounts of a new pair, each from its own start, naming the recorded one first', () => {
    // Visa's bank supplies nothing before September, Everyday's does from June
    const july = pair(VISA.id, EVERYDAY.id, '2026-07-01')
    expect(july.message).toBe(
      `SimpleFIN supplies the transactions in Everyday from ${unbroken('Jun 1, 2026')} to today`,
    )
    expect(july.isDateDisabled?.('2026-07-01')).toBe(true)

    // Both supply mid-September, and the message names the account the transfer is recorded in
    expect(pair(VISA.id, EVERYDAY.id, '2026-09-15').message).toBe(
      `SimpleFIN supplies the transactions in Visa from ${unbroken('Sep 1, 2026')} to today`,
    )
  })

  it('leaves the other account alone when a transfer is edited, since only the one transaction changes', () => {
    const days = check(
      {
        kind: 'transfer',
        account_id: SAVINGS.id,
        counterparty_account_id: VISA.id,
        symmetric_transfer: true,
        date: '2026-09-15',
      },
      createTransaction({ account_id: SAVINGS.id, dt: '2026-08-20' }),
    )

    expectNothingRefused(days)
  })
})
