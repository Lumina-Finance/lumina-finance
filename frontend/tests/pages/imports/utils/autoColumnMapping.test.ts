/**
 * Tests which CSV header the importer guesses for each field, so a column describing a transfer's
 * counterparty account is not taken by the account or amount columns first
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import { guessImportDirectionAnswers, inferColumnMap } from '@/pages/imports/utils'

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
  // reads it, and the file arrives asking for a category column instead of inventing one
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
  it('skips a column whose values fail its own rule rather than mapping it with an error', () => {
    const files = [createFile(
      ['Date'],
      [
        { Date: '2026-01-01' },
        { Date: '' },
        { Date: '2026-01-03' },
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
