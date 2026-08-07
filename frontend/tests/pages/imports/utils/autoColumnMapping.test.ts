/**
 * Tests which CSV header the importer guesses for each field, so a column describing a transfer's
 * counterparty account is not taken by the account or amount columns first
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import { inferColumnMap } from '@/pages/imports/utils'

/**
 * Creates a one-file draft from the given headers and rows
 */
function createFile(headers: string[], rows: ImportFileDraft['rows']): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 1024,
    headers,
    hasHeaderRow: true,
    rows,
    error: null,
  }
}

// The codes a real currency column would hold, so a cell reading CAD is data and one reading
// Amt is a header word
const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD', 'EUR'])

describe('import column inference', () => {
  it('keeps the account column and a transfer\'s counterparty account apart', () => {
    const files = [createFile(
      ['Account', 'Date', 'Amount', 'Category', 'To account'],
      [
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'To account': 'Savings' },
        { Account: 'Chequing', Date: '2026-04-12', Amount: '-12.00', Category: 'Groceries', 'To account': '' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.account_id).toBe('Account')
    expect(map.counterparty_account_id).toBe('To account')
  })

  // A bank export calls the payee the counterparty, so the bare word belongs to the merchant and
  // only the compound form reaches the transfer field
  it('reads a bare counterparty column as the merchant', () => {
    const files = [createFile(
      ['Account', 'Date', 'Amount', 'Category', 'Counterparty'],
      [
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-12.00', Category: 'Groceries', Counterparty: 'Corner Grocer' },
        { Account: 'Chequing', Date: '2026-04-12', Amount: '-8.00', Category: 'Groceries', Counterparty: 'Corner Bakery' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.merchant_id).toBe('Counterparty')
    expect(map.counterparty_account_id).toBe('')
  })

  it('reads a column called counterparty account as the counterparty account', () => {
    const files = [createFile(
      ['Account', 'Date', 'Amount', 'Category', 'Counterparty account'],
      [
        { Account: 'Chequing', Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Counterparty account': 'Savings' },
        { Account: 'Chequing', Date: '2026-04-12', Amount: '-12.00', Category: 'Groceries', 'Counterparty account': '' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.account_id).toBe('Account')
    expect(map.counterparty_account_id).toBe('Counterparty account')
  })

  // The account column is barred from these headers, so it leaves them rather than taking one on
  // the weaker match and leaving the counterparty column unmapped
  it('leaves a destination-account column to the counterparty even with no plain account column', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Category', 'Destination account'],
      [
        { Date: '2026-04-11', Amount: '-500.00', Category: 'Transfer', 'Destination account': 'Savings' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.account_id).toBe('')
    expect(map.counterparty_account_id).toBe('Destination account')
  })

  it('leaves a balance column alone rather than reading it as the amount', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Category', 'Balance'],
      [
        { Date: '2026-04-11', Amount: '-500.00', Category: 'Groceries', Balance: '1200.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Amount')
    expect(Object.values(map)).not.toContain('Balance')
  })

  // The list barring the account field from an account-number column matched whole words only, so a
  // heading written without a separator walked straight past it and account resolution then ran on
  // the numbers
  it('bars the account field from an account-number column written without a separator', () => {
    const files = [createFile(
      ['Date', 'AccountNumber', 'Amount', 'Category'],
      [
        { Date: '2026-04-11', AccountNumber: '1234567890', Amount: '-12.00', Category: 'Groceries' },
        { Date: '2026-04-12', AccountNumber: '1234567890', Amount: '-8.00', Category: 'Groceries' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.account_id).toBe('')
    expect(map.amount).toBe('Amount')
    expect(Object.values(map)).not.toContain('AccountNumber')
  })

  it('bars the account field from an account-number column written all in one word', () => {
    const files = [createFile(
      ['Date', 'accountnumber', 'Amount', 'Category'],
      [
        { Date: '2026-04-11', accountnumber: '1234567890', Amount: '-12.00', Category: 'Groceries' },
        { Date: '2026-04-12', accountnumber: '1234567890', Amount: '-8.00', Category: 'Groceries' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.account_id).toBe('')
    expect(map.amount).toBe('Amount')
  })

  // A column of short text reads as a merchant on its values alone, which used to let it take a
  // column whose heading named the field still waiting for it
  it('gives a column to the field its heading names, not the one its values resemble', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Category', 'Notes'],
      [
        { Date: '2026-04-11', Amount: '-12.00', Category: 'Groceries', Notes: 'weekly shop' },
        { Date: '2026-04-12', Amount: '-8.00', Category: 'Groceries', Notes: 'bread' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.notes).toBe('Notes')
    expect(map.merchant_id).toBe('')
  })

  // Repetitive short text scored for the category field on the values alone, so a direction column
  // was pre-filled as the category and the user had to notice and undo it
  it('leaves a direction column alone rather than reading it as the category', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Type'],
      [
        { Date: '2026-04-11', Amount: '-12.00', Type: 'Debit' },
        { Date: '2026-04-12', Amount: '-8.00', Type: 'Debit' },
        { Date: '2026-04-13', Amount: '20.00', Type: 'Credit' },
        { Date: '2026-04-14', Amount: '-5.00', Type: 'Debit' },
        { Date: '2026-04-15', Amount: '30.00', Type: 'Credit' },
        { Date: '2026-04-16', Amount: '40.00', Type: 'Credit' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.category_id).toBe('')
    expect(Object.values(map)).not.toContain('Type')
  })

  // An import started from an account has no account field to fill, and the column that would have
  // filled it must not fall to another field instead. Three rows over two distinct values is what
  // the merchant field scores on, so this fails if the account field is skipped rather than filled
  // in and then dropped
  it('leaves an account column unmapped rather than passing it to another field when the account is fixed', () => {
    const files = [createFile(
      ['Date', 'Account', 'Amount', 'Category'],
      [
        { Date: '2026-04-11', Account: 'Everyday', Amount: '-12.00', Category: 'Groceries' },
        { Date: '2026-04-12', Account: 'Everyday', Amount: '-8.00', Category: 'Transit' },
        { Date: '2026-04-13', Account: 'Travel Card', Amount: '-20.00', Category: 'Dining' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES, new Set(), {
      omitAccountColumn: true,
    })

    expect(map.account_id).toBe('')
    expect(Object.values(map)).not.toContain('Account')

    // The rest of the file still maps as it always did
    expect(map.dt).toBe('Date')
    expect(map.amount).toBe('Amount')
    expect(map.category_id).toBe('Category')
  })

  it('maps the same account column as usual when the account is not fixed', () => {
    const files = [createFile(
      ['Date', 'Account', 'Amount', 'Category'],
      [
        { Date: '2026-04-11', Account: 'Everyday', Amount: '-12.00', Category: 'Groceries' },
        { Date: '2026-04-12', Account: 'Everyday', Amount: '-8.00', Category: 'Transit' },
        { Date: '2026-04-13', Account: 'Travel Card', Amount: '-20.00', Category: 'Dining' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.account_id).toBe('Account')
  })

  // Reading the alias table by property returned the function every object inherits for this one
  // name, which is truthy, and comparing scores against it left a value nothing could beat: the
  // column claimed whichever field reached it first, and no later column could displace it
  it('scores a column named after an inherited property as any other unknown word', () => {
    const files = [createFile(
      ['Date', 'constructor', 'Amount', 'Category'],
      [
        { Date: '2026-04-11', ['constructor']: 'alpha', Amount: '-12.00', Category: 'Groceries' },
        { Date: '2026-04-12', ['constructor']: 'beta', Amount: '-8.00', Category: 'Groceries' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    // Every other column still lands where its heading says, which the unbeatable score prevented
    expect(map.dt).toBe('Date')
    expect(map.amount).toBe('Amount')
    expect(map.category_id).toBe('Category')

    // The name buys it nothing. It is now read on its values like any other column of short text,
    // which is a merchant rather than the account it used to claim
    expect(map.account_id).toBe('')
  })
})

describe('remembering which columns the user answered for', () => {
  const files = [createFile(
    ['Date', 'Amount', 'Category', 'Notes'],
    [
      { Date: '2026-04-11', Amount: '-12.00', Category: 'Groceries', Notes: 'weekly shop' },
      { Date: '2026-04-12', Amount: '-8.00', Category: 'Groceries', Notes: 'bread' },
    ],
  )]

  it('refills a field the user never answered for when the file is read again', () => {
    const cleared = { ...inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES).map, notes: '' }

    const { map } = inferColumnMap(cleared, files, SUPPORTED_CURRENCY_CODES)

    expect(map.notes).toBe('Notes')
  })

  it('leaves a column the user set to Do not import alone when the file is replaced', () => {
    const cleared = { ...inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES).map, notes: '' }

    const { map } = inferColumnMap(cleared, files, SUPPORTED_CURRENCY_CODES, new Set(['Notes']))

    expect(map.notes).toBe('')
    expect(Object.values(map)).not.toContain('Notes')
  })

  it('still fills the other fields around an answered column', () => {
    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES, new Set(['Notes']))

    expect(map.dt).toBe('Date')
    expect(map.amount).toBe('Amount')
    expect(map.category_id).toBe('Category')
    expect(map.notes).toBe('')
  })
})
