/**
 * Tests which CSV header the importer guesses for each field, so a column describing a transfer's
 * counterparty account is not taken by the account or amount columns first
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  getImportAmountFormatValues,
  guessImportDirectionAnswers,
  inferColumnMap,
  scanImportAmountFormatChoices,
} from '@/pages/imports/utils'

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

  // A bank export calls the merchant the counterparty, so the bare word belongs to the merchant and
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
  // was pre-filled as the category and the user had to notice and undo it. It now goes to the field
  // that reads it, which is the same column claimed by the right one rather than the wrong one
  it('reads a direction column as the direction rather than as the category', () => {
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
    expect(map.amount_direction).toBe('Type')
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

  it('maps a named Amount column before its surrounding currency text is normalized', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Category'],
      [
        { Date: '31.08.2026', Amount: '-CHF100,99', Category: 'Groceries' },
        { Date: '01.09.2026', Amount: 'CHF200,00', Category: 'Income' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Date')
    expect(map.amount).toBe('Amount')
  })

  it('does not infer an unknown text column as Amount from permissive normalization', () => {
    const files = [createFile(
      ['Date', 'Description', 'Mystery'],
      [
        { Date: '2026-04-11', Description: 'Coffee shop', Mystery: '-CHF100,99' },
        { Date: '2026-04-12', Description: 'Payroll', Mystery: 'CHF200,00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('')
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

describe('guessing the column that specifies money in or money out', () => {
  /**
   * Builds a file whose Type column holds the values given, one row each, with a positive amount
   *
   * @param types - What each row's Type cell holds, in file order
   */
  function createTypedFile(types: string[]) {
    return [createFile(
      ['Date', 'Description', 'Amount', 'Type'],
      types.map((type, index) => ({
        Date: `2026-04-${String(index + 1).padStart(2, '0')}`,
        Description: 'Corner store',
        Amount: `${index + 1}2.00`,
        Type: type,
      })),
    )]
  }

  // The file the whole arrangement exists for, and it needs no clicks: the column is claimed and its
  // two words are filled in from what they mean
  it('claims a Type column of two words it recognises', () => {
    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, createTypedFile(['DEBIT', 'CREDIT', 'DEBIT']), SUPPORTED_CURRENCY_CODES)

    expect(map.amount_direction).toBe('Type')
    expect(map.amount).toBe('Amount')
  })

  // Every word here is one this app knows, so the count is the only thing ruling the column out.
  // Words it does not know would rule it out as well, and a column failing for two reasons at once
  // cannot show which of them is doing the work
  it('leaves a Type column of more words than a direction has, though it knows them all', () => {
    const files = createTypedFile(['DEBIT', 'CREDIT', 'DEPOSIT'])

    expect(guessImportDirectionAnswers(['DEBIT', 'CREDIT', 'DEPOSIT'])).not.toEqual({})
    expect(inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES).map.amount_direction).toBe('')
  })

  // A card statement of nothing but purchases carries one word throughout, and that word states the
  // direction of every row. Nothing else claims such a column either, since a single value repeated
  // scores for neither the category nor the merchant field
  it('claims a Type column stating one direction throughout', () => {
    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, createTypedFile(['DEBIT', 'DEBIT', 'DEBIT']), SUPPORTED_CURRENCY_CODES)

    expect(map.amount_direction).toBe('Type')
    expect(map.amount).toBe('Amount')
  })

  // The payment method column a real statement carries, which fails on the count and on the words
  it('leaves a Type column naming payment methods', () => {
    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, createTypedFile(['POS', 'ATM', 'CHQ']), SUPPORTED_CURRENCY_CODES)

    expect(map.amount_direction).toBe('')
  })

  // Two values under a heading like Type are as likely to be something else entirely, and claiming
  // one would block the commit on a question about a file that imports cleanly today
  it('leaves a Type column of two words it does not recognise', () => {
    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, createTypedFile(['Personal', 'Business']), SUPPORTED_CURRENCY_CODES)

    expect(map.amount_direction).toBe('')
  })

  // A heading naming both directions is claimable by neither side, so without this field it went
  // unmapped and every row of the file imported as money coming in
  it('claims a column headed with both directions at once', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Debit/Credit'],
      [
        { Date: '2026-04-11', Amount: '84.20', 'Debit/Credit': 'DEBIT' },
        { Date: '2026-04-12', Amount: '1200.00', 'Debit/Credit': 'CREDIT' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_direction).toBe('Debit/Credit')
  })

  // A file writing its two directions in separate columns carries the direction already, so
  // a Direction column beside them would be the same claim twice and the commit refuses that
  it('leaves the direction unmapped where the two sides are claimed', () => {
    const files = [createFile(
      ['Date', 'Category', 'Debit', 'Credit', 'Type'],
      [
        { Date: '2026-04-11', Category: 'Groceries', Debit: '84.20', Credit: '', Type: 'DEBIT' },
        { Date: '2026-04-12', Category: 'Salary', Debit: '', Credit: '1200.00', Type: 'CREDIT' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('Debit')
    expect(map.amount_in).toBe('Credit')
    expect(map.amount_direction).toBe('')
  })

  // A Type column of Payment and Deposit used to fall to the category field, which scores a column
  // of short repeated text and counts Payment as a category word, so the import created categories
  // called Payment and Deposit out of a column stating direction. It now goes to the field that
  // reads it, and the Category column is left unmapped rather than invented
  it('takes a direction column the category field used to score on its values', () => {
    const files = [createFile(
      ['Date', 'Description', 'Amount', 'Type'],
      [
        { Date: '2026-04-11', Description: 'Rent', Amount: '1200.00', Type: 'Payment' },
        { Date: '2026-04-12', Description: 'Invoice 12', Amount: '900.00', Type: 'Deposit' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_direction).toBe('Type')
    expect(map.category_id).toBe('')
  })

  // A column of money holds far more different values than a direction, which is what keeps this
  // field off one whose heading it half recognises
  it('leaves a money column headed with both directions to be answered by hand', () => {
    const files = [createFile(
      ['Date', 'Debit/Credit Amount'],
      [
        { Date: '2026-04-11', 'Debit/Credit Amount': '-84.20' },
        { Date: '2026-04-12', 'Debit/Credit Amount': '1200.00' },
        { Date: '2026-04-13', 'Debit/Credit Amount': '-12.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_direction).toBe('')
  })
})

describe('reaching the branches only an unusual arrangement of columns exercises', () => {
  // One impossible date in a short file is a row to leave out, not a reason to stop reading the column
  it('maps a date column with one day the calendar does not have', () => {
    const files = [createFile(
      ['Date'],
      [
        { Date: '2024-03-15' },
        { Date: '2024-02-31' },
        { Date: '2024-03-17' },
      ],
    )]

    expect(inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES).map.dt).toBe('Date')
  })

  // Half the rows fitting is not most of them, so a column of half unreadable dates is left to the user
  it('skips a column only half of whose rows hold a real date', () => {
    const files = [createFile(['Date'], [{ Date: '2024-03-15' }, { Date: 'Pending' }])]

    expect(inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES).map.dt).toBe('')
  })

  // A few rows the column doesn't fit are left out and listed, but a column most rows don't fit is not
  // the one the file meant, so it is left for the user to map
  it('skips a column most of whose rows its own rule refuses, rather than mapping it', () => {
    const files = [createFile(
      ['Date'],
      [
        { Date: '2026-01-01' },
        { Date: '' },
        { Date: '' },
      ],
    )]

    const { map, errors } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('')
    expect(errors.Date).toBeUndefined()
  })

  // Inference cannot produce an error of its own, since each candidate is checked against the
  // same rule before it is claimed, so only a mapping that arrived with the argument can come
  // back flagged. Every other case in this file reads the map alone, so this is the first to
  // observe that the errors half of the return is forwarded at all
  it('carries an error the caller supplied through the return, not just what inference finds', () => {
    const files = [createFile(
      ['Date', 'Amount'],
      [
        { Date: '2026-04-11', Amount: '-12.34' },
        { Date: '2026-04-12', Amount: '-8.00' },
        { Date: '2026-04-13', Amount: '45.00' },
      ],
    )]
    const columnMap = { ...EMPTY_COLUMN_MAP, category_id: 'Amount' }

    const { errors } = inferColumnMap(columnMap, files, SUPPORTED_CURRENCY_CODES)

    expect(errors.Amount).toBeDefined()
  })

  it('returns the empty map by reference and no errors when there are no files', () => {
    const { map, errors } = inferColumnMap(EMPTY_COLUMN_MAP, [], SUPPORTED_CURRENCY_CODES)

    expect(map).toBe(EMPTY_COLUMN_MAP)
    expect(errors).toEqual({})
  })

  it('maps fields from the union of headers across two files', () => {
    const files = [
      createFile(
        ['Date', 'Amount'],
        [
          { Date: '2026-04-11', Amount: '-12.00' },
          { Date: '2026-04-12', Amount: '-8.00' },
        ],
      ),
      createFile(
        ['Date', 'Category'],
        [
          { Date: '2026-04-11', Category: 'Groceries' },
          { Date: '2026-04-12', Category: 'Transit' },
        ],
      ),
    ]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Date')
    expect(map.amount).toBe('Amount')
    expect(map.category_id).toBe('Category')
  })

  it('maps the currency field on its values alone when the heading gives it no score', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Ccy'],
      [
        { Date: '2026-04-11', Amount: '-12.00', Ccy: 'CAD' },
        { Date: '2026-04-12', Amount: '-8.00', Ccy: 'USD' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.currency).toBe('Ccy')
  })

  // Three rows of the plan's own example ('a;b' twice, 'c;d' once) still score merchant higher
  // than tags, since a uniqueRatio of 0.667 clears the merchant field's 0.35 floor and merchant is
  // asked first. Only once the repeat brings that ratio down to 0.35 or below does merchant stop
  // scoring and leave the column for tags, which takes six rows split between the two values
  it('claims a repetitive semicolon-separated column for tags rather than merchant', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Misc'],
      [
        { Date: '2026-04-11', Amount: '-12.00', Misc: 'a;b' },
        { Date: '2026-04-12', Amount: '-8.00', Misc: 'a;b' },
        { Date: '2026-04-13', Amount: '-20.00', Misc: 'a;b' },
        { Date: '2026-04-14', Amount: '-5.00', Misc: 'c;d' },
        { Date: '2026-04-15', Amount: '-6.00', Misc: 'c;d' },
        { Date: '2026-04-16', Amount: '-7.00', Misc: 'c;d' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.tag_ids).toBe('Misc')
    expect(map.merchant_id).not.toBe('Misc')
  })

  describe('scoring a repetitive column of words no alias or contains table recognises', () => {
    /**
     * Builds a file whose Misc column repeats each of the given words three times, so the ratio of
     * distinct to repeated values only depends on how many words are given
     */
    function createRepeatedWordFile(words: string[]) {
      const misc = words.flatMap((word) => [word, word, word])
      return [createFile(
        ['Date', 'Amount', 'Misc'],
        misc.map((word, index) => ({
          Date: `2026-04-${String(index + 1).padStart(2, '0')}`,
          Amount: `-${index + 1}.00`,
          Misc: word,
        })),
      )]
    }

    it('leaves the column unmapped for category or merchant below the distinct-value floor', () => {
      const { map } = inferColumnMap(
        EMPTY_COLUMN_MAP,
        createRepeatedWordFile(['Zeta', 'Eta', 'Theta']),
        SUPPORTED_CURRENCY_CODES,
      )

      expect(map.category_id).toBe('')
      expect(map.merchant_id).not.toBe('Misc')
    })

    // Asserting the category field alone would pass whether or not the merchant field had
    // quietly taken the column instead, so both are checked
    it('claims the column for category once it holds enough distinct words, still leaving merchant without it', () => {
      const { map } = inferColumnMap(
        EMPTY_COLUMN_MAP,
        createRepeatedWordFile(['Zeta', 'Eta', 'Theta', 'Iota']),
        SUPPORTED_CURRENCY_CODES,
      )

      expect(map.category_id).toBe('Misc')
      expect(map.merchant_id).not.toBe('Misc')
    })
  })
})

describe('a German or French bank\'s headings', () => {
  it('reads the German wordings of the date, merchant, notes and amount fields', () => {
    const files = [createFile(
      ['Buchungstag', 'Wertstellung', 'Empfänger/Auftraggeber', 'Verwendungszweck', 'Betrag (€)'],
      [
        { Buchungstag: '05.04.2026', Wertstellung: '05.04.2026', 'Empfänger/Auftraggeber': 'Hausverwaltung Nord', Verwendungszweck: 'Miete April', 'Betrag (€)': '-950.00' },
        { Buchungstag: '06.04.2026', Wertstellung: '07.04.2026', 'Empfänger/Auftraggeber': 'Firma Muster', Verwendungszweck: 'Gehalt', 'Betrag (€)': '2500.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Buchungstag')
    expect(map.merchant_id).toBe('Empfänger/Auftraggeber')
    expect(map.notes).toBe('Verwendungszweck')
    expect(map.amount).toBe('Betrag (€)')
  })

  it('reads Betrag as the amount and Verwendungszweck as the notes beside a plain Datum', () => {
    const files = [createFile(
      ['Datum', 'Betrag', 'Verwendungszweck'],
      [
        { Datum: '05.04.2026', Betrag: '-950.00', Verwendungszweck: 'Miete April' },
        { Datum: '06.04.2026', Betrag: '2500.00', Verwendungszweck: 'Gehalt' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Datum')
    expect(map.amount).toBe('Betrag')
    expect(map.notes).toBe('Verwendungszweck')
  })

  it('reads Soll and Haben as money out and money in', () => {
    const files = [createFile(
      ['Datum', 'Verwendungszweck', 'Soll', 'Haben'],
      [
        { Datum: '05.04.2026', Verwendungszweck: 'Miete', Soll: '950.00', Haben: '' },
        { Datum: '06.04.2026', Verwendungszweck: 'Gehalt', Soll: '', Haben: '2500.00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('Soll')
    expect(map.amount_in).toBe('Haben')
    expect(map.amount).toBe('')
  })

  // The accented headings only match once the accent is read as its plain letter. Before that
  // Débit was the two words d and bit, which no table knows
  it('reads accented French headings as their unaccented spelling and keeps Solde out of the money fields', () => {
    const files = [createFile(
      ['Date d\'opération', 'Libellé', 'Débit', 'Crédit', 'Solde'],
      [
        { 'Date d\'opération': '05/04/2026', Libellé: 'CARTE SUPERMARCHE', Débit: '12.50', Crédit: '', Solde: '1234.50' },
        { 'Date d\'opération': '06/04/2026', Libellé: 'VIREMENT SALAIRE', Débit: '', Crédit: '2500.00', Solde: '3734.50' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Date d\'opération')
    expect(map.merchant_id).toBe('Libellé')
    expect(map.amount_out).toBe('Débit')
    expect(map.amount_in).toBe('Crédit')
    expect(map.amount).toBe('')
    expect(Object.values(map)).not.toContain('Solde')
  })

  // The balance comes first so that only its heading, not its place in the file, keeps it from the amount
  it('reads Montant as the amount and keeps a Saldo column out of the amount', () => {
    const files = [createFile(
      ['Date', 'Saldo', 'Montant', 'Libellé'],
      [
        { Date: '05/04/2026', Montant: '-12.50', Libellé: 'CARTE SUPERMARCHE', Saldo: '1234.50' },
        { Date: '06/04/2026', Montant: '2500.00', Libellé: 'VIREMENT SALAIRE', Saldo: '3734.50' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Montant')
    expect(Object.values(map)).not.toContain('Saldo')
  })
})

describe('a German or French heading with a bracketed currency', () => {
  it('is matched by its name, so Montant (EUR) over 12,50 € is the amount and Soll (EUR) is money out', () => {
    const files = [createFile(
      ['Date', 'Libellé', 'Montant (EUR)'],
      [
        { Date: '05/04/2026', Libellé: 'CARTE SUPERMARCHE', 'Montant (EUR)': '-12,50 €' },
        { Date: '06/04/2026', Libellé: 'VIREMENT SALAIRE', 'Montant (EUR)': '2500,00 €' },
      ],
    )]
    const sided = [createFile(
      ['Datum', 'Soll (EUR)', 'Haben (EUR)'],
      [
        { Datum: '05.04.2026', 'Soll (EUR)': '12,50', 'Haben (EUR)': '' },
        { Datum: '06.04.2026', 'Soll (EUR)': '', 'Haben (EUR)': '2500,00' },
      ],
    )]

    expect(inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES).map.amount).toBe('Montant (EUR)')
    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, sided, SUPPORTED_CURRENCY_CODES)
    expect(map.amount_out).toBe('Soll (EUR)')
    expect(map.amount_in).toBe('Haben (EUR)')
  })
})

describe('the German words for the sum of a transaction', () => {
  // A column of plain numbers sits first so the heading, not the order of the file, picks the amount
  it('reads Summe and Umsatz as the amount', () => {
    for (const heading of ['Summe', 'Umsatz']) {
      const files = [createFile(
        ['Vorgang', 'Nr', heading, 'Kennung'],
        [
          { Vorgang: 'Kauf', Nr: '1001', [heading]: '-12.50', Kennung: 'REF 2026' },
          { Vorgang: 'Erstattung', Nr: '1002', [heading]: '1234.56', Kennung: '12 EUR' },
        ],
      )]

      const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

      expect(map.amount).toBe(heading)
    }
  })
})

describe('a column of decimal-comma amounts', () => {
  const AMOUNTS = ['-4,50', '-1.234,50', '2.500,00']
  const DATES = ['05/04/2026', '06/04/2026', '07/04/2026']

  it('is the amount rather than the tags, and the number format preselects the decimal comma', () => {
    const files = [createFile(
      ['Date', 'Description', 'Amount'],
      AMOUNTS.map((amount, index) => ({ Date: DATES[index], Description: 'Corner Grocer', Amount: amount })),
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)
    const { automatic } = scanImportAmountFormatChoices(getImportAmountFormatValues(map, files))

    expect(map.amount).toBe('Amount')
    expect(map.tag_ids).toBe('')
    expect(automatic).toEqual({ decimalSeparator: ',', groupingSeparator: '.' })
  })

  it('is the amount under a German heading', () => {
    const files = [createFile(
      ['Datum', 'Verwendungszweck', 'Betrag (€)'],
      AMOUNTS.map((amount, index) => ({ Datum: DATES[index], Verwendungszweck: 'Miete', 'Betrag (€)': amount })),
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Betrag (€)')
    expect(map.tag_ids).toBe('')
  })

  it('is the amount with no heading to say so, whichever grouping it is written with', () => {
    const files = [createFile(
      ['Date', 'Misc'],
      [
        { Date: DATES[0], Misc: '1 234,50' },
        { Date: DATES[1], Misc: '12,00' },
        { Date: DATES[2], Misc: '-1234,5' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Misc')
    expect(map.tag_ids).toBe('')
  })

  // Cells with text beside the digits are references or amounts with a currency, which the guesser
  // leaves for the user to map rather than reading them as amounts from their shape
  it('never guesses a column of cells with text beside the digits as an amount', () => {
    const files = [createFile(
      ['Date', 'Misc'],
      [
        { Date: DATES[0], Misc: 'REF 2026' },
        { Date: DATES[1], Misc: '12 EUR' },
        { Date: DATES[2], Misc: 'REF 2027' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('')
    expect(map.amount_out).toBe('')
    expect(map.amount_in).toBe('')
  })

  it('leaves a balance column alone whether it is headed Balance or Solde', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Solde', 'Balance'],
      [
        { Date: DATES[0], Amount: '-4,50', Solde: '1 234,50', Balance: '1 234,50' },
        { Date: DATES[1], Amount: '12,00', Solde: '12,00', Balance: '12,00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Amount')
    expect(Object.values(map)).not.toContain('Solde')
    expect(Object.values(map)).not.toContain('Balance')
  })

  // Words with a comma in them are still the tags or notes the column's heading or shape says,
  // since only a cell made of digits and separators reads as an amount
  it('does not take a column of words with commas in them for amounts', () => {
    const files = [createFile(
      ['Date', 'Amount', 'Notes'],
      [
        { Date: DATES[0], Amount: '-4.50', Notes: 'rent, april' },
        { Date: DATES[1], Amount: '12.00', Notes: 'gift, may' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.notes).toBe('Notes')
    expect(map.amount).toBe('Amount')
    expect(map.tag_ids).toBe('')
  })

  it('does not take a column of dates written with periods for amounts', () => {
    const files = [createFile(
      ['Buchungstag', 'Betrag'],
      [
        { Buchungstag: '05.04.2026', Betrag: '-4,50' },
        { Buchungstag: '06.04.2026', Betrag: '12,00' },
      ],
    )]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Buchungstag')
    expect(map.amount).toBe('Betrag')
  })
})

/**
 * Creates the rows of a draft from a heading line and the records under it
 */
function toRows(headers: string[], records: string[][]) {
  return records.map((record) => Object.fromEntries(
    headers.map((header, index) => [header, record[index] ?? '']),
  ))
}

/**
 * Creates a one-file draft from a heading line and the records under it, the way a bank's export
 * reads, so each language's test copies its heading set as the bank publishes it
 *
 * Three columns go ahead of the bank's own, under headings no language gives a field: dates, plain
 * numbers and short names. Each is exactly what its field would take from the values alone, and the
 * first column wins a tie, so a bank heading the importer fails to read lets a decoy take the field
 * and the test goes red, which the bank's own values would never do since they are as fit as the
 * decoy's
 */
function createExport(headers: string[], records: string[][]) {
  const decoyHeaders = ['Extra 1', 'Extra 2', 'Extra 3']
  const allHeaders = [...decoyHeaders, ...headers]
  const decoyRecords = records.map((record, index) => [
    `2026-01-0${index + 1}`,
    `${index + 1}0.00`,
    `Shop ${index + 1}`,
    ...record,
  ])

  return [createFile(allHeaders, toRows(allHeaders, decoyRecords))]
}

// Each heading set is copied from a real bank's export, its documentation or a published sample of
// it. The values under them decide nothing: a short description could be any text column, and a
// column of numbers would take the amount on its shape alone
describe('a bank\'s headings in a language other than English, German or French', () => {
  // ING Netherlands writes its dates as 20260405, which the reader does not take, so only the other
  // fields are asked of it
  it('reads ING Netherlands\' Dutch headings, with Af Bij as the direction', () => {
    const files = createExport(
      ['Datum', 'Naam / Omschrijving', 'Rekening', 'Tegenrekening', 'Code', 'Af Bij', 'Bedrag (EUR)', 'Mutatiesoort', 'Mededelingen', 'Saldo na mutatie', 'Tag'],
      [
        ['20260405', 'Albert Heijn 1234', 'NL20INGB0001234567', '', 'BA', 'Af', '12,50', 'Betaalautomaat', 'Pasvolgnr: 001 05-04-2026 14:32', '1234,50', ''],
        ['20260406', 'Werkgever BV', 'NL20INGB0001234567', 'NL91ABNA0417164300', 'GT', 'Bij', '2500,00', 'Overschrijving', 'Salaris april', '3734,50', ''],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.merchant_id).toBe('Naam / Omschrijving')
    expect(map.amount).toBe('Bedrag (EUR)')
    expect(map.amount_direction).toBe('Af Bij')
    expect(map.notes).toBe('Mededelingen')
    expect(Object.values(map)).not.toContain('Saldo na mutatie')
    expect(guessImportDirectionAnswers(['af', 'bij'])).toEqual({ af: 'out', bij: 'in' })
  })

  it('reads UniCredit\'s Italian headings, leaving Valuta, the value date, out of the currency', () => {
    const files = createExport(
      ['Data', 'Valuta', 'Descrizione', 'Euro', 'Caus.'],
      [
        ['27/02/2024', '27/02/2024', 'PAGAMENTO POS 1234 SUPERMERCATO ESSELUNGA MILANO CARTA 5678', '-136.72', '208'],
        ['28/02/2024', '01/03/2024', 'BONIFICO A VOSTRO FAVORE DA AZIENDA SRL STIPENDIO FEBBRAIO', '2500.00', '048'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Data')
    expect(map.merchant_id).toBe('Descrizione')
    expect(map.amount).toBe('Euro')
    expect(map.currency).not.toBe('Valuta')
  })

  it('reads ING Spain\'s Spanish headings', () => {
    const files = createExport(
      ['F. VALOR', 'CATEGORÍA', 'SUBCATEGORÍA', 'DESCRIPCIÓN', 'COMENTARIO', 'IMAGEN', 'IMPORTE (€)', 'SALDO (€)'],
      [
        ['05/04/2026', 'Alimentación', 'Supermercados', 'Pago en MERCADONA', 'Compra semanal', 'No', '-45,30', '1.234,50'],
        ['06/04/2026', 'Nómina y otras prestaciones', 'Nómina', 'Nómina recibida EMPRESA SL', '', 'No', '2.500,00', '3.734,50'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('F. VALOR')
    expect(map.merchant_id).toBe('DESCRIPCIÓN')
    expect(map.notes).toBe('COMENTARIO')
    expect(map.amount).toBe('IMPORTE (€)')
    expect(Object.values(map)).not.toContain('SALDO (€)')
  })

  // Nubank's account export has no balance column
  it('reads Nubank\'s Brazilian Portuguese headings over its transaction identifier', () => {
    const files = createExport(
      ['Data', 'Valor', 'Identificador', 'Descrição'],
      [
        ['01/03/2026', '-50.00', '6a1e0f2c-6d4b-4f0e-9b1a-2f3c4d5e6f70', 'Compra no débito - PADARIA'],
        ['05/03/2026', '1000.00', '7b2f1a3d-7e5c-4a1f-8c2b-3a4d5e6f7a81', 'Transferência recebida pelo Pix - FULANO'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Data')
    expect(map.amount).toBe('Valor')
    expect(map.merchant_id).toBe('Descrição')
  })

  it('reads SEB\'s Swedish headings over its verification number', () => {
    const files = createExport(
      ['Bokföringsdag', 'Valutadag', 'Verifikationsnummer', 'Text/mottagare', 'Belopp', 'Saldo'],
      [
        ['2026-04-05', '2026-04-05', '5484381424', 'ICA SUPERMARKET', '-125,00', '10 234,50'],
        ['2026-04-06', '2026-04-06', '5484381425', 'LÖN', '25 000,00', '35 234,50'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Bokföringsdag')
    expect(map.merchant_id).toBe('Text/mottagare')
    expect(map.amount).toBe('Belopp')
    expect(Object.values(map)).not.toContain('Saldo')
  })

  it('reads Spar Nord\'s Danish headings over the receiving account number', () => {
    const files = createExport(
      ['Modtagerkonto', 'Dato', 'Tekst', 'Beløb', 'Saldo', 'Indbetaler', 'Supp. tekst til modtager', 'Tekst til modtager'],
      [
        ['90001234567', '05.04.2026', 'Netto Østerbro', '-125,50', '10.234,50', '', '', ''],
        ['90001234567', '06.04.2026', 'Løn april', '25.000,00', '35.234,50', 'Firma ApS', '', 'Løn'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Dato')
    expect(map.merchant_id).toBe('Tekst')
    expect(map.amount).toBe('Beløb')
    expect(Object.values(map)).not.toContain('Saldo')
  })

  // DNB's export has no balance column
  it('reads DNB\'s Norwegian headings, with Ut fra konto and Inn på konto as the pair', () => {
    const files = createExport(
      ['Dato', 'Forklaring', 'Rentedato', 'Ut fra konto', 'Inn på konto'],
      [
        ['14.09.2026', 'Varekjøp Kiwi Lund Dronningens Gate Kristiansand', '17.09.2026', '146.98', ''],
        ['14.09.2026', 'Lønn fra Extra Sørlandsparken', '16.09.2026', '', '9840.6'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Dato')
    expect(map.merchant_id).toBe('Forklaring')
    expect(map.amount_out).toBe('Ut fra konto')
    expect(map.amount_in).toBe('Inn på konto')
    expect(map.amount).toBe('')
  })

  it('reads OP\'s Finnish headings, with the payee and the message in their own fields', () => {
    const files = createExport(
      ['Kirjauspäivä', 'Arvopäivä', 'Määrä EUROA', 'Tapahtumalajikoodi', 'Selitys', 'Saaja/Maksaja', 'Saajan tilinumero', 'Viite', 'Viesti', 'Arkistotunnus'],
      [
        ['05.04.2026', '05.04.2026', '-12,50', '106', 'KORTTIOSTO', 'K-MARKET KAMPPI', '', '', 'Ostos', '20260405/593497/123456'],
        ['06.04.2026', '06.04.2026', '2500,00', '710', 'PALKKA', 'YRITYS OY', 'FI4950009420028730', '', 'Palkka huhtikuu', '20260406/593497/123457'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Kirjauspäivä')
    expect(map.amount).toBe('Määrä EUROA')
    expect(map.merchant_id).toBe('Saaja/Maksaja')
    expect(map.notes).toBe('Viesti')
  })

  it('reads PKO BP\'s Polish headings, keeping the balance after each transaction out of the amount', () => {
    const files = createExport(
      ['Data operacji', 'Data waluty', 'Typ transakcji', 'Kwota', 'Waluta', 'Saldo po transakcji', 'Opis transakcji'],
      [
        ['2026-04-05', '2026-04-04', 'Płatność kartą', '-3.20', 'PLN', '+5628.08', 'Tytuł: 010061097 74169509109951095304354'],
        ['2026-04-06', '2026-04-06', 'Przelew na konto', '2500.00', 'PLN', '+8128.08', 'Tytuł: Wynagrodzenie kwiecień'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Data operacji')
    expect(map.amount).toBe('Kwota')
    expect(map.merchant_id).toBe('Opis transakcji')
    expect(Object.values(map)).not.toContain('Saldo po transakcji')
  })

  // Headings written in Japanese, Korean or Chinese used to reduce to nothing, since every letter
  // outside a to z was read as a break between words
  it('reads SMBC\'s Japanese headings, with お引出し and お預入れ as the pair and 残高 kept out', () => {
    const files = createExport(
      ['年月日', 'お引出し', 'お預入れ', 'お取り扱い内容', '残高', 'メモ', 'ラベル'],
      [
        ['2026/4/5', '1,200', '', 'カード(1234)', '98,800', '', ''],
        ['2026/4/25', '', '250,000', '給与 カブシキガイシヤ', '348,800', '', ''],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('年月日')
    expect(map.amount_out).toBe('お引出し')
    expect(map.amount_in).toBe('お預入れ')
    expect(map.merchant_id).toBe('お取り扱い内容')
    expect(Object.values(map)).not.toContain('残高')
  })

  // KB writes the date and the time of day in one cell, 2026.03.01 09:00:00, which the reader does
  // not take, so only the other fields are asked of it
  it('reads KB Kookmin Bank\'s Korean headings, with 출금액 and 입금액 as the pair', () => {
    const files = createExport(
      ['거래일시', '적요', '보낸분/받는분', '송금메모', '출금액', '입금액', '잔액', '거래점'],
      [
        ['2026.03.01 09:00:00', '체크카드', '스타벅스', '', '5,000', '', '145,000', '강남'],
        ['2026.03.02 10:00:00', '모바일', '어머니', '용돈', '', '100,000', '245,000', '본점'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.merchant_id).toBe('보낸분/받는분')
    expect(map.notes).toBe('송금메모')
    expect(map.amount_out).toBe('출금액')
    expect(map.amount_in).toBe('입금액')
  })

  // Yuanta writes its dates as 20260821, which the reader does not take, so only the other fields
  // are asked of it
  it('reads Yuanta Bank\'s Traditional Chinese headings, with 支出金額 and 存入金額 as the pair', () => {
    const files = createExport(
      ['帳號', '帳務日期', '交易日期', '交易時間', '交易說明', '支出金額', '存入金額', '帳面餘額', '票據號碼', '備註'],
      [
        ['0012345678901234', '20260821', '20260821', '09:10:11', '跨行提款', '1,000', '', '9,000', '', ''],
        ['0012345678901234', '20260822', '20260822', '10:20:30', '薪資轉入', '', '50,000', '59,000', '', '八月薪資'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.merchant_id).toBe('交易說明')
    expect(map.notes).toBe('備註')
    expect(map.amount_out).toBe('支出金額')
    expect(map.amount_in).toBe('存入金額')
  })
})

// A file with a payee column of its own gives the merchant field to it, and a description heading
// then falls to Notes at the lower score the description wordings carry there. The values are short,
// so the shape of a long text column does not claim Notes in its place
describe('a description heading in a language other than English, German or French, beside a payee', () => {
  it.each([
    ['Italian', 'Descrizione'],
    ['Spanish', 'Descripción'],
    ['Portuguese', 'Descrição'],
    ['Danish', 'Tekst'],
    ['Norwegian', 'Forklaring'],
    ['Polish', 'Opis transakcji'],
    ['Japanese', 'お取り扱い内容'],
    ['Traditional Chinese', '交易說明'],
  ])('reads %s\'s %s as the notes', (_language, heading) => {
    const headers = ['Date', 'Payee', heading, 'Amount']
    const files = [createFile(headers, toRows(headers, [
      ['2026-04-05', 'Corner Grocer', 'Lunch', '-12.50'],
      ['2026-04-06', 'Employer', 'Pay', '2500.00'],
    ]))]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.merchant_id).toBe('Payee')
    expect(map.notes).toBe(heading)
  })
})

// The numbers under a balance heading look exactly like an amount, so only the heading keeps the
// column out of Amount and the sides. There is no amount column beside it to take the field instead
describe('a balance column with no amount column', () => {
  it.each([
    ['a Dutch, Spanish, Portuguese or Nordic', 'Saldo'],
    ['a Polish', 'Saldo po transakcji'],
    ['a full-width', 'Ｓａｌｄｏ'],
    ['a Japanese', '残高'],
    ['a Japanese compound', '差引残高'],
    ['a Korean', '잔액'],
    ['a Korean compound', '거래후잔액'],
    ['a Traditional Chinese', '餘額'],
    ['a Traditional Chinese compound', '帳面餘額'],
  ])('keeps %s balance heading, %s, out of the money fields', (_language, heading) => {
    const headers = ['Date', 'Memo', heading]
    const files = [createFile(headers, toRows(headers, [
      ['2026-04-05', 'Lunch', '1234.50'],
      ['2026-04-06', 'Pay', '3734.50'],
    ]))]

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('')
    expect(map.amount_out).toBe('')
    expect(map.amount_in).toBe('')
  })
})

// Japanese and Chinese files often write letters, digits and brackets in their full-width forms
describe('a heading written in full-width characters', () => {
  it('reads a full-width bracketed unit after a heading as the plain heading', () => {
    const files = createExport(
      ['年月日', 'お引出し（円）', 'お預入れ（円）'],
      [
        ['2026/4/5', '1,200', ''],
        ['2026/4/25', '', '250,000'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount_out).toBe('お引出し（円）')
    expect(map.amount_in).toBe('お預入れ（円）')
  })

  it('reads full-width Latin letters as their plain letters', () => {
    const files = createExport(
      ['Ｂｅｔｒａｇ'],
      [['12,50'], ['2500,00']],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.amount).toBe('Ｂｅｔｒａｇ')
  })
})

// The headings are the ones the export of Caixa Geral de Depósitos reads in, as a published notebook
// that analyses it names them: Data mov., Data valor, Descrição, Débito, Crédito, Saldo contab. and
// Saldo disponível
describe('a Portuguese bank\'s headings', () => {
  const caixaHeadings = ['Data mov.', 'Data valor', 'Descrição', 'Débito', 'Crédito', 'Saldo contab.', 'Saldo disponível']

  it('reads Caixa Geral de Depósitos\' headings, with Débito and Crédito as the pair', () => {
    const files = createExport(
      caixaHeadings,
      [
        ['05-04-2026', '06-04-2026', 'COMPRA CONTINENTE LISBOA', '45,30', '', '1.234,50', '1.234,50'],
        ['07-04-2026', '07-04-2026', 'TRF RECEBIDA EMPRESA LDA', '', '2.500,00', '3.734,50', '3.734,50'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Data mov.')
    expect(map.merchant_id).toBe('Descrição')
    expect(map.amount_out).toBe('Débito')
    expect(map.amount_in).toBe('Crédito')
  })

  it('reads the movement date as the date, ahead of a value date that comes first', () => {
    const files = createExport(
      ['Data valor', 'Data mov.', 'Descrição', 'Débito', 'Crédito'],
      [
        ['06-04-2026', '05-04-2026', 'COMPRA CONTINENTE LISBOA', '45,30', ''],
        ['07-04-2026', '07-04-2026', 'TRF RECEBIDA EMPRESA LDA', '', '2.500,00'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Data mov.')
  })

  it('reads a value date as the date when the file has no movement date', () => {
    const files = createExport(
      ['Data valor', 'Descrição', 'Débito', 'Crédito'],
      [
        ['06-04-2026', 'COMPRA CONTINENTE LISBOA', '45,30', ''],
        ['07-04-2026', 'TRF RECEBIDA EMPRESA LDA', '', '2.500,00'],
      ],
    )

    const { map } = inferColumnMap(EMPTY_COLUMN_MAP, files, SUPPORTED_CURRENCY_CODES)

    expect(map.dt).toBe('Data valor')
  })
})
