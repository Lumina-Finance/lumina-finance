/**
 * Tests reading OFX statements: the same statement in OFX 1.x SGML and 2.x XML reads the
 * same, and a file that is not a bank or credit card statement is refused or left out loudly
 */
import { describe, expect, it, vi } from 'vitest'
import {
  OFX_NO_STATEMENTS_REASON,
  OFX_NOT_READABLE_REASON,
  OFX_ONLY_LEFT_OUT_REASON,
  OFX_STATEMENT_INCOMPLETE_REASON,
  OFX_TOO_LARGE_REASON,
  MAX_OFX_FILE_BYTES,
} from '@/pages/imports/ofx/constants'
import type { OfxFile } from '@/pages/imports/ofx/types'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import {
  buildLeftOutMessageSet,
  buildMessageSet,
  buildSgmlOfx,
  buildXmlOfx,
  SGML_HEADER,
  toOfxFile,
  wrapMessageSets,
  type FixtureStatement,
} from './fixtures'

async function readFile(contents: string | Uint8Array, name?: string): Promise<OfxFile> {
  const read = await readOfxFile(toOfxFile(contents, name), 'the-file')
  if (read.status !== 'read') throw new Error(read.reason)
  return read.file
}

async function readReason(contents: string | Uint8Array) {
  const read = await readOfxFile(toOfxFile(contents))
  if (read.status !== 'refused') throw new Error('The file was read')
  return read.reason
}

const CHECKING: FixtureStatement = {
  transactions: [
    { posted: '20240115120000', amount: '-12.50', fitId: 'A1', name: 'Corner Cafe', memo: 'Latte' },
    { posted: '20240116', amount: '2500.00', fitId: 'A2', name: 'Payroll' },
  ],
}

describe('reading a bank statement', () => {
  it('reads the same statement alike from OFX 1.x SGML and OFX 2.x XML', async () => {
    const sgml = await readFile(buildSgmlOfx([CHECKING]))
    const xml = await readFile(buildXmlOfx([CHECKING]))

    expect(xml).toEqual(sgml)
    expect(sgml.statements).toHaveLength(1)
    const [statement] = sgml.statements
    expect(statement).toMatchObject({
      kind: 'bank',
      name: 'Checking ending 6789',
      label: 'Checking ending 6789 (CAD)',
      proposedType: 'checking',
      currency: 'CAD',
    })
    expect(statement.transactions).toEqual([
      expect.objectContaining({ date: '2024-01-15', amount: '-12.50', payee: 'Corner Cafe', memo: 'Latte' }),
      expect.objectContaining({ date: '2024-01-16', amount: '2500.00', payee: 'Payroll', memo: null }),
    ])
  })

  it('reads a QFX file, which adds an Intuit-only field to the sign-on, like the OFX file it extends', async () => {
    const qfx = buildSgmlOfx([CHECKING]).replace('<DTSERVER>20240201\n', '<DTSERVER>20240201\n<INTU.BID>3000\n')
    expect(qfx).toContain('<INTU.BID>3000')

    expect(await readFile(qfx, 'statement.qfx')).toEqual(await readFile(buildSgmlOfx([CHECKING]), 'statement.qfx'))
  })

  // The server hashes the account key and the bank ID it is sent, and its tests pin the hash of this
  // pair, so the account key must be built from the routing ID and the account number as it is here
  it('reads the bank account key and the bank\'s transaction ID as the file wrote them, keeps the file each transaction is in, and null for an ID the file leaves out', async () => {
    const file = await readFile(buildSgmlOfx([{ transactions: [{ fitId: 'A1' }, { fitId: null }] }]), '2024-01.qfx')

    expect(file.statements[0].transactions.map(({ bankAccountKey, bankTransactionId, fileName }) => ({ bankAccountKey, bankTransactionId, fileName }))).toEqual([
      { bankAccountKey: 'bank:123000456:000123456789', bankTransactionId: 'A1', fileName: '2024-01.qfx' },
      { bankAccountKey: 'bank:123000456:000123456789', bankTransactionId: null, fileName: '2024-01.qfx' },
    ])
  })

  it('reads a file where the browser withholds crypto.subtle and crypto.randomUUID, as on a page opened over plain HTTP', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    try {
      // The stub must really take these away, or this proves nothing about a page on plain HTTP
      expect([crypto.randomUUID, (crypto as { subtle?: unknown }).subtle]).toEqual([undefined, undefined])
      const reads = await Promise.all([readOfxFile(toOfxFile(buildSgmlOfx([CHECKING]))), readOfxFile(toOfxFile(buildSgmlOfx([CHECKING])))])

      const origins = reads.map((read) => (read.status === 'read' ? read.file.statements[0].transactions[0] : null))
      expect(origins.map((transaction) => transaction?.bankTransactionId)).toEqual(['A1', 'A1'])
      expect(origins[0]?.fileId).not.toBe(origins[1]?.fileId)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads a bank statement and a credit card statement of one file as two statements', async () => {
    const file = await readFile(buildSgmlOfx([
      CHECKING,
      { kind: 'creditCard', currency: 'USD', transactions: [{ amount: '-30.00', name: 'Hardware' }] },
    ]))

    expect(file.statements.map(({ kind, name, currency, proposedType }) => ({ kind, name, currency, proposedType }))).toEqual([
      { kind: 'bank', name: 'Checking ending 6789', currency: 'CAD', proposedType: 'checking' },
      { kind: 'creditCard', name: 'Credit card ending 1111', currency: 'USD', proposedType: 'credit_card' },
    ])
  })

  it('keeps two statements of one account apart so each can be answered', async () => {
    const file = await readFile(buildSgmlOfx([CHECKING, CHECKING]))

    expect(new Set(file.statements.map((statement) => statement.id)).size).toBe(2)
    expect(file.statements.map((statement) => statement.name)).toEqual(['Checking ending 6789', 'Checking ending 6789 (2)'])
  })

  // What sets the second statement apart on the page must stay out of the account key, or its
  // transactions would never match the same ones imported from a file holding that statement alone
  it('keys a transaction of the second statement of one account as it would alone', async () => {
    const second: FixtureStatement = { transactions: [{ fitId: 'X' }] }
    const [, split] = (await readFile(buildSgmlOfx([CHECKING, second]))).statements
    const [alone] = (await readFile(buildSgmlOfx([second]))).statements

    expect(alone.transactions[0].bankAccountKey).toBe('bank:123000456:000123456789')
    expect(split.transactions[0].bankAccountKey).toBe(alone.transactions[0].bankAccountKey)
  })

  it('reads the date a stamp starts with, the amount with a comma decimal, and entities in names', async () => {
    const file = await readFile(buildSgmlOfx([{
      transactions: [{ posted: '20240229235959.000[-5:EST]', amount: '-1234,50', name: 'Fish &amp; Chips &amp;lt;', memo: 'Table &#35;4' }],
    }]))

    expect(file.statements[0].transactions[0]).toMatchObject({
      date: '2024-02-29',
      amount: '-1234.50',
      payee: 'Fish & Chips &lt;',
      memo: 'Table #4',
    })
  })

  it('keeps a transaction with an unreadable date or amount, with that value left null', async () => {
    const file = await readFile(buildSgmlOfx([{
      transactions: [
        { posted: '20240230', amount: '-5.00' },
        { posted: '20240110', amount: 'twelve' },
        { posted: '20240110', amount: '-5.00', name: 'Fine' },
      ],
    }]))

    expect(file.statements[0].transactions.map(({ date, amount }) => ({ date, amount }))).toEqual([
      { date: null, amount: '-5.00' },
      { date: '2024-01-10', amount: null },
      { date: '2024-01-10', amount: '-5.00' },
    ])
  })

  it('decodes a 1.x file that declares Windows-1252', async () => {
    const markup = buildSgmlOfx([{ transactions: [{ name: 'Café', amount: '-3.00' }] }])
    const bytes = Uint8Array.from(markup, (character) => character.charCodeAt(0))

    expect((await readFile(bytes)).statements[0].transactions[0].payee).toBe('Café')
  })

  it.each(['ISO-8859-1', 'iso-8859-1'])('decodes a 1.x file that declares %s', async (charset) => {
    const markup = buildMessageSet({ transactions: [{ name: 'Dépanneur', memo: 'Crème', amount: '-3.00' }] }, false)
    const text = wrapMessageSets([markup], SGML_HEADER.replace('CHARSET:1252', `CHARSET:${charset}`))
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0))

    expect(bytes.includes(0xe9)).toBe(true)
    expect((await readFile(bytes)).statements[0].transactions[0]).toMatchObject({ payee: 'Dépanneur', memo: 'Crème' })
  })

  it('decodes UTF-8 where the header declares no legacy charset', async () => {
    const text = wrapMessageSets([buildMessageSet({ transactions: [{ name: 'Dépanneur', amount: '-3.00' }] }, false)], SGML_HEADER.replace('CHARSET:1252', 'CHARSET:NONE'))

    expect((await readFile(new TextEncoder().encode(text))).statements[0].transactions[0].payee).toBe('Dépanneur')
  })

  // An SGML tag with nothing after it is an empty value, so the tags that follow stay siblings
  it('keeps the payee and memo that follow an empty tag in a 1.x transaction', async () => {
    const file = await readFile(buildSgmlOfx([{
      transactions: [
        { extra: '<CHECKNUM>\n', name: 'Cafe', memo: 'Rent', amount: '-3.00' },
        { name: '', memo: 'Only a memo', amount: '-4.00' },
      ],
    }]))

    expect(file.statements[0].transactions).toEqual([
      expect.objectContaining({ payee: 'Cafe', memo: 'Rent', amount: '-3.00' }),
      expect.objectContaining({ payee: null, memo: 'Only a memo', amount: '-4.00' }),
    ])
  })

  // A CURRENCY block says the amount is in that currency. An ORIGCURRENCY block only records the
  // foreign amount the statement-currency amount was converted from
  it('reads only a CURRENCY block naming another currency as an amount in it', async () => {
    const block = (tag: string, code: string) => `<${tag}>\n<CURRATE>0.75\n<CURSYM>${code}\n</${tag}>\n`
    const file = await readFile(buildSgmlOfx([{
      transactions: [
        { extra: block('CURRENCY', 'USD'), amount: '-1.00' },
        { extra: block('ORIGCURRENCY', 'eur'), amount: '-2.00' },
        { extra: block('CURRENCY', 'CAD'), amount: '-3.00' },
        { amount: '-4.00' },
      ],
    }]))

    expect(file.statements[0].transactions.map((transaction) => transaction.otherCurrency)).toEqual(['USD', null, null, null])
  })
})

describe('a file that crashes the reader', () => {
  it('refuses a file with thousands of unclosed tags as not a statement, instead of failing', async () => {
    const markup = `<OFX>${'<STMTTRNRS>'.repeat(10_000)}`

    expect(await readReason(markup)).toBe(OFX_NOT_READABLE_REASON)
  })

  it('refuses a file the reader throws on as not a statement', async () => {
    const hostile = { size: 1, name: 'statement.ofx', arrayBuffer: () => Promise.reject(new Error('boom')) } as unknown as File

    expect(await readOfxFile(hostile)).toEqual({ status: 'refused', reason: OFX_NOT_READABLE_REASON })
  })
})

describe('statements the import leaves out or refuses', () => {
  it('counts investment and loan statements it leaves out beside the ones it reads', async () => {
    const markup = wrapMessageSets([
      buildLeftOutMessageSet('INVSTMTMSGSRSV1', 2),
      buildLeftOutMessageSet('LOANMSGSRSV1', 1),
      buildMessageSet(CHECKING, false),
    ])
    const file = await readFile(markup)

    expect(file.leftOut).toEqual({ investment: 2, loan: 1 })
    expect(file.statements).toHaveLength(1)
  })

  it('refuses a file holding only investment and loan statements, saying so', async () => {
    const markup = wrapMessageSets([buildLeftOutMessageSet('INVSTMTMSGSRSV1', 1)])

    expect(await readReason(markup)).toBe(OFX_ONLY_LEFT_OUT_REASON)
  })

  it('refuses an OFX file with no statement in it', async () => {
    expect(await readReason(wrapMessageSets([]))).toBe(OFX_NO_STATEMENTS_REASON)
  })

  it('refuses a CSV file renamed to .ofx', async () => {
    expect(await readReason('Date,Amount,Description\n2024-01-15,-12.50,Cafe\n')).toBe(OFX_NOT_READABLE_REASON)
  })

  it.each([
    ['a currency', { currency: null }],
    ['an account number', { accountId: null }],
  ])('refuses a statement with no %s', async (_label, missing) => {
    expect(await readReason(buildSgmlOfx([{ ...CHECKING, ...missing }]))).toBe(OFX_STATEMENT_INCOMPLETE_REASON)
  })

  it('refuses a file over the size the import reads without decoding it', async () => {
    const read = await readOfxFile(new File([new Uint8Array(MAX_OFX_FILE_BYTES + 1)], 'big.ofx'))

    expect(read).toEqual({ status: 'refused', reason: OFX_TOO_LARGE_REASON })
  })
})
