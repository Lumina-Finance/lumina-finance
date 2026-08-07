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

describe('a file writing money out and money in in columns of their own', () => {
  /**
   * Creates a statement whose two amount columns pad the unused side with a zero, under the headings
   * given, so the only thing separating the two is what they are called
   */
  function createTwoSidedFile(outHeader: string, inHeader: string) {
    return [createFile(
      ['Date', 'Description', outHeader, inHeader],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', [outHeader]: '4.50', [inHeader]: '0.00' },
        { Date: '2026-04-12', Description: 'Payroll', [outHeader]: '0.00', [inHeader]: '2100.00' },
        { Date: '2026-04-13', Description: 'Hardware store', [outHeader]: '82.10', [inHeader]: '0.00' },
      ],
    )]
  }

  // Both columns are numeric down every row, so before the two sides existed the single Amount field
  // took whichever came first in the file and the other column's rows all imported as 0.00
  it('gives each side its own field', () => {
    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, createTwoSidedFile('Debit', 'Credit'), SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('Debit')
    expect(map.amount_in).toBe('Credit')
    expect(map.amount).toBe('')
  })

  it('reads the same file the same way with the two columns swapped', () => {
    const files = [createFile(
      ['Date', 'Description', 'Credit', 'Debit'],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', Credit: '0.00', Debit: '4.50' },
        { Date: '2026-04-12', Description: 'Payroll', Credit: '2100.00', Debit: '0.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('Debit')
    expect(map.amount_in).toBe('Credit')
    expect(map.amount).toBe('')
  })

  it('reads a file naming its sides in plain words rather than in bookkeeping terms', () => {
    const { map } = inferColumnMap(
      EMPTY_COLUMN_MAP,
      createTwoSidedFile('Withdrawals', 'Deposits'),
      SUPPORTED_CURRENCY_CODES,
    )

    expect(map.amount_out).toBe('Withdrawals')
    expect(map.amount_in).toBe('Deposits')
  })

  // Naming both directions, it is one signed column rather than one side of a pair. Claiming it as
  // money out would sign every row that way, half of them wrongly
  it('leaves a lone column naming both directions for the user to answer', () => {
    const files = [createFile(
      ['Date', 'Description', 'Debit/Credit Amount'],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', 'Debit/Credit Amount': '-4.50' },
        { Date: '2026-04-12', Description: 'Payroll', 'Debit/Credit Amount': '2100.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('')
    expect(map.amount_in).toBe('')
    expect(map.amount).toBe('')
  })

  // A statement often carries the signed total beside the breakdown, and all three headings match
  // outright, so without this the guess hands back a map the commit then refuses
  it('keeps the signed column and drops both sides where a file carries all three', () => {
    const files = [createFile(
      ['Date', 'Description', 'Amount', 'Debit', 'Credit'],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', Amount: '-4.50', Debit: '4.50', Credit: '0.00' },
        { Date: '2026-04-12', Description: 'Payroll', Amount: '2100.00', Debit: '0.00', Credit: '2100.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Amount')
    expect(map.amount_out).toBe('')
    expect(map.amount_in).toBe('')
  })

  // Each is money by shape or a run of digits, and each carries a word one side is called, so it
  // would reach that side on its heading alone. Tested without the plain column it competes with,
  // since that column outscores it anyway and would decide the answer instead of the exclusion
  it.each([
    ['Credit Limit', '5000.00'],
    ['Available Credit', '4200.00'],
    ['Credit Card Number', '4111111111111111'],
    ['Debit Balance', '820.00'],
  ])('leaves a %s column to neither side', (header, value) => {
    const files = [createFile(
      ['Date', 'Description', header],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', [header]: value },
        { Date: '2026-04-12', Description: 'Payroll', [header]: value },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('')
    expect(map.amount_in).toBe('')
  })

  // The compound headings are the ones the single Amount field would otherwise take, since it scores
  // on the word they end with. A bare Debit never reaches it, so those say nothing about this rule
  it.each(['Debit Amount', 'Credit Amount', 'Withdrawal Amount', 'Deposit Amount'])(
    'keeps the single Amount field off a %s column',
    (header) => {
      const files = [createFile(
        ['Date', 'Description', header],
        [
          { Date: '2026-04-11', Description: 'Coffee shop', [header]: '4.50' },
          { Date: '2026-04-12', Description: 'Hardware store', [header]: '82.10' },
        ],
      )]

      const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

      expect(map.amount).toBe('')
    },
  )

  // Both sides matched their own headings at full score, so a numeric column still going spare is a
  // fee rather than the transaction amount. Letting the single field take it on its values alone
  // costs both sides, and every row then imports as the zero the unused side is padded with
  it('leaves a spare numeric column alone rather than reading it as the amount', () => {
    const files = [createFile(
      ['Date', 'Description', 'Debit', 'Credit', 'Fee'],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', Debit: '84.31', Credit: '0.00', Fee: '0.00' },
        { Date: '2026-04-12', Description: 'Payroll', Debit: '0.00', Credit: '2100.00', Fee: '0.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('Debit')
    expect(map.amount_in).toBe('Credit')
    expect(map.amount).toBe('')
  })

  // One side matching says nothing about how the file writes its amounts, so neither is guessed and
  // the user answers the amount row against the samples the table shows. Guessing the half that
  // matched is the worst outcome, since the other column is then read as the whole transaction
  it.each([
    ['Withdrawal', 'Fee'],
    ['Net', 'Deposit'],
  ])('guesses no side at all where only %s or %s matched', (first, second) => {
    const files = [createFile(
      ['Date', 'Description', first, second],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', [first]: '-4.50', [second]: '0.00' },
        { Date: '2026-04-12', Description: 'Payroll', [first]: '2100.00', [second]: '2100.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('')
    expect(map.amount_in).toBe('')
  })

  it('reads a lone signed column as the amount', () => {
    const files = [createFile(
      ['Date', 'Description', 'Net'],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', Net: '-4.50' },
        { Date: '2026-04-12', Description: 'Payroll', Net: '2100.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Net')
  })

  // The single field scores on the word these headings end with, and reading a one-directional
  // column as the whole transaction signs half the file wrongly. Every wording either side knows has
  // to be barred from it, not just the bookkeeping ones
  it.each([
    'Money Out Amount',
    'Money In Amount',
    'Outgoing Amount',
    'Incoming Amount',
    'Outflow Amount',
    'Inflow Amount',
    'Paid Out Amount',
    'Paid In Amount',
    'Withdrawn Amount',
    'Deposited Amount',
  ])('keeps the single Amount field off a %s column', (header) => {
    const files = [createFile(
      ['Date', 'Description', header],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', [header]: '4.50' },
        { Date: '2026-04-12', Description: 'Payroll', [header]: '82.10' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('')
  })

  // Matching one side and not the other is worse than matching neither: the unmatched column falls
  // to the single Amount field, which then takes the whole arrangement with it
  it('matches both sides of a file written in the past tense', () => {
    const files = [createFile(
      ['Date', 'Withdrawn', 'Deposited'],
      [
        { Date: '2026-04-11', Withdrawn: '84.31', Deposited: '0.00' },
        { Date: '2026-04-12', Withdrawn: '0.00', Deposited: '2100.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('Withdrawn')
    expect(map.amount_in).toBe('Deposited')
    expect(map.amount).toBe('')
  })

  // Nothing the guesser does clears a field that already holds a column, so an answer the user gave
  // survives a file being replaced, which is what every other mapping already promises
  it('leaves an answered side alone when the file is read again', () => {
    const files = [createFile(
      ['Date', 'Description', 'Debit', 'Credit'],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', Debit: '4.50', Credit: '0.00' },
      ],
    )]
    const answered = { ...EMPTY_COLUMN_MAP, amount_out: 'Debit' }

    const { map } = inferColumnMap(answered, files, SUPPORTED_CURRENCY_CODES, new Set(['Debit']))

    expect(map.amount_out).toBe('Debit')
  })
})
