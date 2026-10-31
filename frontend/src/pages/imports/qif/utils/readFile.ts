import type { AccountType } from '@/api/accounts'
import type { OfxFileRead, OfxStatement, OfxStatementKind, OfxTransaction } from '@/pages/imports/ofx/types'
import {
  getQifUnknownSectionReason,
  MAX_QIF_FILE_BYTES,
  QIF_ASSET_ACCOUNT,
  QIF_BANK_ACCOUNT,
  QIF_CASH_ACCOUNT,
  QIF_CREDIT_CARD_ACCOUNT,
  QIF_LIABILITY_ACCOUNT,
  QIF_NO_TRANSACTIONS_REASON,
  QIF_NOT_READABLE_REASON,
  QIF_ONLY_LEFT_OUT_REASON,
  QIF_TOO_LARGE_REASON,
  QIF_TRUNCATED_REASON,
} from '@/pages/imports/qif/constants'
import { createRandomId } from '@/utils/randomId'

const NUL = '\u0000'
const LINE_BREAK_PATTERN = /\r\n|\r|\n/
const RECORD_END = '^'
const HEADER_START = '!'
const TYPE_HEADER_PREFIX = '!type:'
const ACCOUNT_HEADER = '!account'
const OPTION_HEADER_PREFIX = '!option:'

// Switching the current account on and off for the account list a file opens with. Once the list is
// cleared the next transactions name their own account, or none
const CLEAR_AUTO_SWITCH_DIRECTIVE = '!clear:autoswitch'

/** The kinds of section that hold an account's transactions, by their header with spaces removed */
const TRANSACTION_SECTIONS: Record<string, { kind: OfxStatementKind; account: { type: AccountType; label: string } }> =
  {
    bank: { kind: 'bank', account: QIF_BANK_ACCOUNT },
    cash: { kind: 'bank', account: QIF_CASH_ACCOUNT },
    ccard: { kind: 'creditCard', account: QIF_CREDIT_CARD_ACCOUNT },
    otha: { kind: 'bank', account: QIF_ASSET_ACCOUNT },
    othl: { kind: 'loan', account: QIF_LIABILITY_ACCOUNT },
  }

const INVESTMENT_SECTION = 'invst'

// Lists a file carries beside its transactions. They hold no transactions, so they are passed over
const LIST_SECTIONS = new Set(['cat', 'class', 'tag', 'memorized', 'security', 'prices', 'price', 'budget', 'payee'])

type Field = readonly [code: string, value: string]
type Section =
  | { type: 'account' }
  | { type: 'transactions'; kind: OfxStatementKind; account: { type: AccountType; label: string } }
  | { type: 'passed-over' }

/**
 * Reads a QIF file into the accounts it holds, each as a statement with no currency
 *
 * A QIF file states neither a currency nor how its dates and amounts are written, so every
 * transaction keeps the text of its date and amounts and leaves `date` and `amount` null. The
 * reading choices resolve them once every staged file is known. A file with an investment section
 * counts it as left out. A section the reader does not know, or a file that ends inside a
 * transaction, refuses the file, since going on would guess
 *
 * @param file - The uploaded file, sent nowhere as it is
 * @param fileId - What tells this file's transactions from those of another file of the same name
 */
export async function readQifFile(file: File, fileId: string = createRandomId()): Promise<OfxFileRead> {
  if (file.size > MAX_QIF_FILE_BYTES) return { status: 'refused', reason: QIF_TOO_LARGE_REASON }

  // A file the reader cannot get through is refused as not a QIF file, as a crash would otherwise
  // leave the upload with no word on why it did nothing
  try {
    return readQifText(decodeQifBytes(await file.arrayBuffer()), { fileId, fileName: file.name })
  } catch {
    return { status: 'refused', reason: QIF_NOT_READABLE_REASON }
  }
}

/**
 * Decodes the file as UTF-16 where a byte order mark says so, as UTF-8 where it is valid UTF-8, and
 * otherwise as Windows-1252, the code page the format's own exporters write
 */
function decodeQifBytes(bytes: ArrayBuffer) {
  const start = new Uint8Array(bytes.slice(0, 2))
  if (start[0] === 0xff && start[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (start[0] === 0xfe && start[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

function readQifText(text: string, origin: { fileId: string; fileName: string }): OfxFileRead {
  // The database cannot hold a NUL character, so one kept in a memo, payee or account name would fail
  // the whole save with no reason given. A text export has none, so a file with one is not read
  if (text.includes(NUL)) return { status: 'refused', reason: QIF_NOT_READABLE_REASON }

  const lines = text
    .split(LINE_BREAK_PATTERN)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (!lines[0]?.startsWith(HEADER_START)) return { status: 'refused', reason: QIF_NOT_READABLE_REASON }

  const statements = new Map<string, OfxStatement>()
  const leftOut = { investment: 0 }
  const fileBaseName = origin.fileName.replace(/\.[^.]*$/, '').trim()
  let section: Section | null = null
  let account: string | null = null
  let fields: Field[] = []

  for (const line of lines) {
    if (line.startsWith(HEADER_START)) {
      // A header cannot interrupt a record, which only a caret ends
      if (fields.length > 0) return { status: 'refused', reason: QIF_TRUNCATED_REASON }

      const header = line.toLowerCase()
      if (header === CLEAR_AUTO_SWITCH_DIRECTIVE) {
        account = null
        continue
      }

      if (header === ACCOUNT_HEADER) {
        section = { type: 'account' }
      } else if (header.startsWith(TYPE_HEADER_PREFIX)) {
        const name = header.slice(TYPE_HEADER_PREFIX.length).replace(/\s+/g, '')
        const transactions = TRANSACTION_SECTIONS[name]
        if (transactions) {
          section = { type: 'transactions', ...transactions }
        } else if (name === INVESTMENT_SECTION) {
          leftOut.investment += 1
          section = { type: 'passed-over' }
        } else if (LIST_SECTIONS.has(name)) {
          section = { type: 'passed-over' }
        } else {
          return { status: 'refused', reason: getQifUnknownSectionReason(line) }
        }
      }

      // An option setting changes nothing the import reads. Any other header, such as a section
      // header cut short, would leave the transactions after it in the wrong section
      if (
        !header.startsWith(OPTION_HEADER_PREFIX) &&
        header !== ACCOUNT_HEADER &&
        !header.startsWith(TYPE_HEADER_PREFIX)
      ) {
        return { status: 'refused', reason: getQifUnknownSectionReason(line) }
      }

      continue
    }

    // A line holding only its code is a field with no value, which still belongs to the record
    if (line !== RECORD_END) {
      fields.push([line[0], line.slice(1).trim()])
      continue
    }

    const record = fields
    fields = []
    if (section?.type === 'account') {
      account = findField(record, 'N') || account
    } else if (section?.type === 'transactions' && record.length > 0) {
      // A transaction states its date and amount once, so a second means a caret went missing and
      // the next transaction has run into this one
      if (countFields(record, 'D') > 1 || countFields(record, 'T') > 1) {
        return { status: 'refused', reason: QIF_TRUNCATED_REASON }
      }

      const id = account === null ? `qif:${origin.fileId}:${section.kind}:${section.account.label}` : `qif:${account}`
      let statement = statements.get(id)
      if (!statement) {
        const name = account ?? (fileBaseName || section.account.label)
        statement = {
          id,
          kind: section.kind,
          name,
          label: name,
          proposedType: section.account.type,
          currency: null,
          transactions: [],
        }
        statements.set(id, statement)
      }
      statement.transactions.push(readTransaction(record, statement.transactions.length + 1, origin))
    }
  }

  if (fields.length > 0) return { status: 'refused', reason: QIF_TRUNCATED_REASON }

  if (statements.size === 0) {
    return { status: 'refused', reason: leftOut.investment > 0 ? QIF_ONLY_LEFT_OUT_REASON : QIF_NO_TRANSACTIONS_REASON }
  }

  return { status: 'read', file: { statements: [...statements.values()], leftOut } }
}

/** The first value a record gives a field, or an empty string where it gives none */
function findField(record: Field[], code: string) {
  return record.find(([fieldCode]) => fieldCode === code)?.[1] ?? ''
}

function countFields(record: Field[], code: string) {
  return record.filter(([fieldCode]) => fieldCode === code).length
}

function readTransaction(record: Field[], index: number, origin: { fileId: string; fileName: string }): OfxTransaction {
  const amountText = findField(record, 'T')
  const alternateAmountText = findField(record, 'U')

  return {
    index,
    ...origin,

    // A file read alone is the first of the files, until combining them orders it among the others
    fileOrder: 1,
    bankAccountKey: '',
    bankTransactionId: null,
    postedText: findField(record, 'D'),
    date: null,
    amountText: amountText || alternateAmountText,
    amount: null,
    alternateAmountText: amountText && alternateAmountText ? alternateAmountText : null,
    splitAmountTexts: record.filter(([code]) => code === '$').map(([, value]) => value),
    payee: findField(record, 'P') || null,
    memo: findField(record, 'M') || null,
    otherCurrency: null,
  }
}
