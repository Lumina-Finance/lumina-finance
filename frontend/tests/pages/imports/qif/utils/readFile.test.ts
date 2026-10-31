/**
 * Tests reading QIF files: each account section of a file reads as one account, a section that holds
 * no transactions is skipped loudly or refused rather than guessed, and a record is never read apart
 * from its caret so no transaction is cut short or joined to another
 */
import { describe, expect, it } from 'vitest'
import {
  getQifUnknownSectionReason,
  MAX_QIF_FILE_BYTES,
  QIF_NO_TRANSACTIONS_REASON,
  QIF_NOT_READABLE_REASON,
  QIF_ONLY_LEFT_OUT_REASON,
  QIF_TOO_LARGE_REASON,
  QIF_TRUNCATED_REASON,
} from '@/pages/imports/qif/constants'
import { readQifFile } from '@/pages/imports/qif/utils/readFile'
import type { OfxFile } from '@/pages/imports/ofx/types'
import { toQifFile } from './fixtures'

async function readFile(contents: string | Uint8Array, name = 'export.qif'): Promise<OfxFile> {
  const read = await readQifFile(toQifFile(contents, name), 'the-file')
  if (read.status !== 'read') throw new Error(read.reason)
  return read.file
}

async function readReason(contents: string | Uint8Array) {
  const read = await readQifFile(toQifFile(contents), 'the-file')
  if (read.status !== 'refused') throw new Error('The file was read')
  return read.reason
}

const BANK = ['!Type:Bank', 'D1/2/2024', 'T-1,234.50', 'PCorner Store', 'MGroceries', '^'].join('\n')

describe('readQifFile sections', () => {
  it.each([
    ['!Type:Bank', 'checking', 'bank'],
    ['!Type:Cash', 'cash', 'bank'],
    ['!Type:CCard', 'credit_card', 'creditCard'],
    ['!Type:Oth A', 'checking', 'bank'],
    ['!Type:Oth L', 'loan', 'loan'],
  ])('reads a %s section as a %s account', async (header, proposedType, kind) => {
    const file = await readFile([header, 'D1/2/2024', 'T10.00', '^'].join('\n'))

    expect(file.statements).toHaveLength(1)
    expect(file.statements[0]).toMatchObject({ proposedType, kind, currency: null })
    expect(file.statements[0].transactions).toHaveLength(1)
  })

  it('keeps the text of the date and amount, leaving the values for the reading choices', async () => {
    const [transaction] = (await readFile(BANK)).statements[0].transactions

    expect(transaction).toMatchObject({
      postedText: '1/2/2024',
      amountText: '-1,234.50',
      date: null,
      amount: null,
      payee: 'Corner Store',
      memo: 'Groceries',
      bankTransactionId: null,
    })
  })

  it('reads the T line, then the U line when the file has only that one', async () => {
    const file = await readFile(
      ['!Type:Bank', 'D1/2/2024', 'U5.00', '^', 'D1/3/2024', 'T6.00', 'U6.00', '^'].join('\n'),
    )
    const [onlyU, both] = file.statements[0].transactions

    expect(onlyU).toMatchObject({ amountText: '5.00', alternateAmountText: null })
    expect(both).toMatchObject({ amountText: '6.00', alternateAmountText: '6.00' })
  })

  it('collects the split amounts without making them the transaction amount', async () => {
    const split = ['!Type:Bank', 'D1/2/2024', 'T-100.00', 'SFood', 'EA', '$-60.00', 'SGas', '$-40.00', '^'].join('\n')
    const [transaction] = (await readFile(split)).statements[0].transactions

    expect(transaction.amountText).toBe('-100.00')
    expect(transaction.splitAmountTexts).toEqual(['-60.00', '-40.00'])
  })

  it('keeps a transaction with missing fields so the import can list it as skipped', async () => {
    const file = await readFile(['!Type:Bank', 'PNo date or amount', '^', 'D1/2/2024', '^'].join('\n'))

    expect(file.statements[0].transactions.map(({ postedText, amountText }) => [postedText, amountText])).toEqual([
      ['', ''],
      ['1/2/2024', ''],
    ])
  })

  it('reads a file with Windows line breaks and no final newline', async () => {
    const file = await readFile(BANK.replaceAll('\n', '\r\n'))
    expect(file.statements[0].transactions).toHaveLength(1)
  })

  it('numbers the transactions of a statement from 1', async () => {
    const file = await readFile([BANK, '!Type:Bank', 'D1/3/2024', 'T1.00', '^'].join('\n'))
    expect(file.statements[0].transactions.map(({ index }) => index)).toEqual([1, 2])
  })
})

describe('readQifFile accounts', () => {
  const MULTI = [
    '!Option:AutoSwitch',
    '!Account',
    'NChequing',
    'TBank',
    '^',
    'NVisa',
    'TCCard',
    '^',
    '!Clear:AutoSwitch',
    '!Account',
    'NChequing',
    '^',
    '!Type:Bank',
    'D1/2/2024',
    'T-5.00',
    '^',
    '!Account',
    'NVisa',
    '^',
    '!Type:CCard',
    'D1/3/2024',
    'T-9.00',
    '^',
  ].join('\n')

  it('files each transaction under the account that was current when it was written', async () => {
    const { statements } = await readFile(MULTI)

    expect(statements.map(({ name, kind, transactions }) => [name, kind, transactions.length])).toEqual([
      ['Chequing', 'bank', 1],
      ['Visa', 'creditCard', 1],
    ])
  })

  it('keeps the transactions of one account together when its section comes back', async () => {
    const twice = [MULTI, '!Account', 'NChequing', '^', '!Type:Bank', 'D1/4/2024', 'T-1.00', '^'].join('\n')
    const { statements } = await readFile(twice)

    expect(statements.find(({ name }) => name === 'Chequing')?.transactions).toHaveLength(2)
  })

  it('names an account the file does not name after the file, one per kind', async () => {
    const { statements } = await readFile([BANK, '!Type:CCard', 'D1/2/2024', 'T-1.00', '^'].join('\n'), 'household.qif')

    expect(statements.map(({ name }) => name)).toEqual(['household', 'household'])
    expect(new Set(statements.map(({ id }) => id)).size).toBe(2)
  })

  it('keeps the unnamed accounts of two files apart', async () => {
    const first = await readQifFile(toQifFile(BANK, 'a.qif'), 'file-1')
    const second = await readQifFile(toQifFile(BANK, 'b.qif'), 'file-2')
    if (first.status !== 'read' || second.status !== 'read') throw new Error('Not read')

    expect(first.file.statements[0].id).not.toBe(second.file.statements[0].id)
  })
})

describe('readQifFile sections it does not import', () => {
  const INVESTMENT = ['!Type:Invst', 'D1/2/2024', 'NBuy', 'YACME', 'Q10', 'T100.00', '^'].join('\n')

  it('counts an investment section as left out and keeps the other accounts', async () => {
    const file = await readFile([BANK, INVESTMENT].join('\n'))

    expect(file.leftOut).toEqual({ investment: 1 })
    expect(file.statements).toHaveLength(1)
  })

  it('refuses a file that holds only investments, saying so', async () => {
    expect(await readReason(INVESTMENT)).toBe(QIF_ONLY_LEFT_OUT_REASON)
  })

  it('passes over the lists a file carries beside its transactions', async () => {
    const lists = ['!Type:Cat', 'NFood', 'E', '^', '!Type:Class', 'NHome', '^', '!Type:Tag', 'NTrip', '^'].join('\n')
    const file = await readFile([lists, BANK].join('\n'))

    expect(file.statements[0].transactions).toHaveLength(1)
  })

  it('refuses a section it does not know instead of guessing at its fields', async () => {
    expect(await readReason(['!Type:Mystery', 'D1/2/2024', 'T1.00', '^'].join('\n'))).toBe(
      getQifUnknownSectionReason('!Type:Mystery'),
    )
  })

  it('refuses a file with no transactions in it', async () => {
    expect(await readReason('!Type:Bank\n')).toBe(QIF_NO_TRANSACTIONS_REASON)
  })
})

describe('readQifFile files it refuses', () => {
  it('refuses a file cut off before the caret that ends a record', async () => {
    expect(await readReason(['!Type:Bank', 'D1/2/2024', 'T1.00', '^', 'D1/3/2024', 'T2.00'].join('\n'))).toBe(
      QIF_TRUNCATED_REASON,
    )
  })

  it('refuses a header that arrives inside a record', async () => {
    expect(await readReason(['!Type:Bank', 'D1/2/2024', '!Type:Cash', 'T1.00', '^'].join('\n'))).toBe(
      QIF_TRUNCATED_REASON,
    )
  })

  it('refuses text that is not a QIF file', async () => {
    expect(await readReason('date,amount\n2024-01-02,5.00\n')).toBe(QIF_NOT_READABLE_REASON)
  })

  it('refuses an empty file', async () => {
    expect(await readReason('')).toBe(QIF_NOT_READABLE_REASON)
  })

  // Two dates or two amounts in one record mean a caret went missing, so reading on would keep the
  // first amount and silently lose the second transaction
  it.each([
    ['a second amount', ['!Type:Bank', 'D1/1/99', 'T10', 'D1/2/99', 'T20', '^']],
    ['a second date', ['!Type:Bank', 'D1/1/99', 'D1/2/99', 'T10', '^']],
    ['a second amount after a payee', ['!Type:Bank', 'D1/1/99', 'T10', 'PShop', 'T20', '^']],
  ])('refuses a record with %s', async (_name, lines) => {
    expect(await readReason(lines.join('\n'))).toBe(QIF_TRUNCATED_REASON)
  })

  it('still reads one date and amount per record, and an alternate amount beside the amount', async () => {
    const file = await readFile(['!Type:Bank', 'D1/1/99', 'T10', 'U10', '^', 'D1/2/99', 'T20', '^'].join('\n'))
    expect(file.statements[0].transactions.map(({ amountText }) => amountText)).toEqual(['10', '20'])
  })

  it('refuses a file whose last record is only a date line cut off before its caret', async () => {
    expect(await readReason(['!Type:Bank', 'D1/1/99', 'T10', '^', 'D'].join('\n'))).toBe(QIF_TRUNCATED_REASON)
  })

  it('lists a record whose date and amount lines are empty instead of dropping it', async () => {
    const file = await readFile(['!Type:Bank', 'D1/1/99', 'T10', '^', 'D', 'T', '^'].join('\n'))

    expect(file.statements[0].transactions.map(({ postedText, amountText }) => [postedText, amountText])).toEqual([
      ['1/1/99', '10'],
      ['', ''],
    ])
  })

  it.each(['!Typ', '!Type', '!type bank'])('refuses the unknown header %s, even as the last line', async (header) => {
    expect(await readReason([BANK, header].join('\n'))).toBe(getQifUnknownSectionReason(header))
    expect(await readReason([header, 'D1/1/99', 'T10', '^'].join('\n'))).toBe(getQifUnknownSectionReason(header))
  })

  it('refuses a file larger than the limit before reading it, and reads one of exactly that size as text', async () => {
    const oversized = new Uint8Array(MAX_QIF_FILE_BYTES + 1)
    expect(await readReason(oversized)).toBe(QIF_TOO_LARGE_REASON)
    expect(await readReason(new Uint8Array(MAX_QIF_FILE_BYTES))).toBe(QIF_NOT_READABLE_REASON)
  })

  // The database cannot hold a NUL character, so one in a memo, payee or account name would fail
  // the whole save with no reason given. A file with one is no text export, such as UTF-16 text with
  // no byte order mark, so it is refused up front
  it.each(['M', 'P', 'N'])('refuses a file with a NUL character in a %s line', async (code) => {
    const lines = ['!Account', 'NChequing', '^', '!Type:Bank', 'D1/2/2024', 'T1.00', `${code}Paid\u0000cash`, '^']
    expect(await readReason(lines.join('\n'))).toBe(QIF_NOT_READABLE_REASON)
  })

  it('refuses UTF-16 text that has no byte order mark', async () => {
    const units = [...BANK].map((character) => character.charCodeAt(0))
    expect(await readReason(new Uint8Array(units.flatMap((unit) => [unit, 0])))).toBe(QIF_NOT_READABLE_REASON)
  })

  it('refuses a file the browser cannot read as not a QIF file', async () => {
    const unreadable = { name: 'export.qif', size: 10, arrayBuffer: () => Promise.reject(new Error('gone')) }
    const read = await readQifFile(unreadable as unknown as File, 'the-file')

    expect(read).toEqual({ status: 'refused', reason: QIF_NOT_READABLE_REASON })
  })
})

describe('readQifFile headers', () => {
  it.each(['!TYPE:BANK', '!type:bank', '!Type:Bank'])('reads the header %s whatever its case', async (header) => {
    const file = await readFile([header, 'D1/2/2024', 'T1.00', '^'].join('\n'))
    expect(file.statements).toHaveLength(1)
  })

  it.each(['Cat', 'Class', 'Tag', 'Memorized', 'Security', 'Prices', 'Price', 'Budget', 'Payee'])(
    'passes over a !Type:%s list and its records, keeping the transactions after it',
    async (list) => {
      const file = await readFile([`!Type:${list}`, 'NSomething', 'DOther', 'T5', '^', BANK].join('\n'))

      expect(file.statements).toHaveLength(1)
      expect(file.statements[0].transactions).toHaveLength(1)
    },
  )

  it('files transactions that follow the end of the account list under the account the file is named for', async () => {
    const file = await readFile(
      ['!Option:AutoSwitch', '!Account', 'NChequing', 'TBank', '^', '!Clear:AutoSwitch', BANK].join('\n'),
      'household.qif',
    )

    expect(file.statements.map(({ name }) => name)).toEqual(['household'])
  })
})

describe('readQifFile very long records', () => {
  it('reads a record of half a million split lines without a call stack error', async () => {
    const splits = Array.from({ length: 500_000 }, () => '$1')
    const file = await readFile(['!Type:Bank', 'D1/2/2024', 'T500000', ...splits, '^'].join('\n'))

    expect(file.statements[0].transactions[0].splitAmountTexts).toHaveLength(500_000)
  })
})

describe('readQifFile encodings', () => {
  const lines = ['!Type:Bank', 'D1/2/2024', 'T1.00', 'PCafé Été', '^'].join('\n')

  it('reads UTF-8', async () => {
    expect((await readFile(new TextEncoder().encode(lines))).statements[0].transactions[0].payee).toBe('Café Été')
  })

  it('reads Windows-1252, the code page of older exports', async () => {
    const bytes = Uint8Array.from(lines, (character) => character.charCodeAt(0))
    expect((await readFile(bytes)).statements[0].transactions[0].payee).toBe('Café Été')
  })

  it('reads UTF-16 with a byte order mark', async () => {
    const units = [...lines].map((character) => character.charCodeAt(0))
    const bytes = new Uint8Array([0xff, 0xfe, ...units.flatMap((unit) => [unit & 0xff, unit >> 8])])
    expect((await readFile(bytes)).statements[0].transactions[0].payee).toBe('Café Été')
  })
})
