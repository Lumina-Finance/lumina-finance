import {
  MAX_OFX_FILE_BYTES,
  OFX_ACCOUNT_NUMBER_TAIL_LENGTH,
  OFX_INSECURE_CONNECTION_BLOCK,
  OFX_BANK_ACCOUNT_TYPES,
  OFX_CREDIT_CARD_ACCOUNT,
  OFX_DEFAULT_BANK_ACCOUNT,
  OFX_NO_STATEMENTS_REASON,
  OFX_NOT_READABLE_REASON,
  OFX_ONLY_LEFT_OUT_REASON,
  OFX_STATEMENT_INCOMPLETE_REASON,
  OFX_TOO_LARGE_REASON,
} from '@/pages/imports/ofx/constants'
import type { OfxFileRead, OfxStatement, OfxStatementKind, OfxTransaction } from '@/pages/imports/ofx/types'
import type { ImportUploadBlock } from '@/pages/imports/types'
import { findAllDescendants, findChild, parseOfxMarkup, readLeaf, type OfxNode } from './markup'

// The 1.x header is plain ASCII lines before the markup, so a prefix is enough to find its charset
const HEADER_PREFIX_BYTES = 1024
const POSTED_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})/

// A plain signed decimal. OFX writes the decimal separator as a period or a comma and never groups
const AMOUNT_PATTERN = /^([+-]?)(\d+)(?:[.,](\d+))?$/

const CURRENCY_PATTERN = /^[A-Z]{3}$/

// The message sets whose statements the import leaves out, each holding one response per statement
const LEFT_OUT_MESSAGE_SETS = { investment: 'INVSTMTMSGSRSV1', loan: 'LOANMSGSRSV1' } as const

/**
 * Reads an OFX file into the bank and credit card statements it holds
 *
 * Investment and loan statements are counted and left out. A statement with no account number or
 * currency refuses the file, since it could not be matched to an account or kept in the right
 * currency. A transaction whose date or amount cannot be read is kept with that value null, so the
 * import lists it as skipped instead of refusing the file
 *
 * @param file - The uploaded file, never sent anywhere
 * @param fileId - What tells this file's transactions from those of another file of the same name
 */
export async function readOfxFile(file: File, fileId: string = crypto.randomUUID()): Promise<OfxFileRead> {
  if (file.size > MAX_OFX_FILE_BYTES) return { status: 'refused', reason: OFX_TOO_LARGE_REASON }

  // A file the reader cannot get through is refused as not a statement, as a crash would otherwise
  // leave the upload with no word on why it did nothing
  try {
    return await readOfxStatements(decodeOfxBytes(await file.arrayBuffer()), { fileId, fileName: file.name })
  } catch {
    return { status: 'refused', reason: OFX_NOT_READABLE_REASON }
  }
}

/** The file a statement is read from, which each of its transactions records */
type OfxFileOrigin = Pick<OfxTransaction, 'fileId' | 'fileName'>

async function readOfxStatements(text: string, origin: OfxFileOrigin): Promise<OfxFileRead> {
  const root = parseOfxMarkup(text)
  if (!root) return { status: 'refused', reason: OFX_NOT_READABLE_REASON }

  const leftOut = {
    investment: countStatementResponses(root, LEFT_OUT_MESSAGE_SETS.investment),
    loan: countStatementResponses(root, LEFT_OUT_MESSAGE_SETS.loan),
  }
  const sections: Array<{ kind: OfxStatementKind; node: OfxNode }> = [
    ...findAllDescendants(root, 'STMTRS').map((node) => ({ kind: 'bank' as const, node })),
    ...findAllDescendants(root, 'CCSTMTRS').map((node) => ({ kind: 'creditCard' as const, node })),
  ]

  const statements: OfxStatement[] = []
  for (const { kind, node } of sections) {
    const statement = await readStatement(kind, node, origin)
    if (!statement) return { status: 'refused', reason: OFX_STATEMENT_INCOMPLETE_REASON }
    statements.push(statement)
  }

  if (statements.length === 0) {
    const holdsLeftOut = leftOut.investment + leftOut.loan > 0
    return { status: 'refused', reason: holdsLeftOut ? OFX_ONLY_LEFT_OUT_REASON : OFX_NO_STATEMENTS_REASON }
  }

  return { status: 'read', file: { statements: nameStatements(statements), leftOut } }
}

/**
 * Decodes the file as UTF-8, or as the charset its 1.x header declares
 *
 * The header writes a Windows code page as its number (1252) and any other charset by name
 * (ISO-8859-1), and says NONE where the text is UTF-8. A charset the browser cannot decode is read
 * as UTF-8
 */
function decodeOfxBytes(bytes: ArrayBuffer) {
  const header = new TextDecoder('latin1').decode(bytes.slice(0, HEADER_PREFIX_BYTES))
  const charset = /^CHARSET:\s*(\S+)/im.exec(header)?.[1]?.toLowerCase()
  const label = charset && /^\d+$/.test(charset) ? `windows-${charset}` : charset
  try {
    return new TextDecoder(label && label !== 'none' ? label : 'utf-8').decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Counts the statements of a message set the import leaves out, one per response it holds */
function countStatementResponses(root: OfxNode, messageSetName: string) {
  return findAllDescendants(root, messageSetName).reduce((total, messageSet) => {
    const responses = messageSet.children.filter((child) => child.name.endsWith('TRNRS')).length
    return total + Math.max(responses, 1)
  }, 0)
}

async function readStatement(kind: OfxStatementKind, node: OfxNode, origin: OfxFileOrigin): Promise<OfxStatement | null> {
  const currency = readLeaf(node, 'CURDEF')?.toUpperCase()
  const account = findChild(node, kind === 'bank' ? 'BANKACCTFROM' : 'CCACCTFROM')
  const accountNumber = account && readLeaf(account, 'ACCTID')
  if (!currency || !CURRENCY_PATTERN.test(currency) || !account || !accountNumber) return null

  const typeName = (kind === 'bank' ? readLeaf(account, 'ACCTTYPE') : null)?.toUpperCase() ?? ''
  const accountKind = kind === 'creditCard'
    ? OFX_CREDIT_CARD_ACCOUNT
    : OFX_BANK_ACCOUNT_TYPES[typeName] ?? OFX_DEFAULT_BANK_ACCOUNT
  const bankId = kind === 'bank' ? readLeaf(account, 'BANKID') : null
  const tail = accountNumber.replace(/[^A-Za-z0-9]/g, '').slice(-OFX_ACCOUNT_NUMBER_TAIL_LENGTH)
  const name = `${accountKind.label} ending ${tail || accountNumber}`

  // Kept in the browser only: it tells statements of one bank account apart from another's while
  // the files are combined, and reaches the server only inside each transaction's one-way hash
  const accountKey = [kind, bankId, accountNumber].filter(Boolean).join(':')
  const transactions = findAllDescendants(node, 'STMTTRN')
  return {
    id: accountKey,
    kind,
    name,
    label: `${name} (${currency})`,
    proposedType: accountKind.type,
    currency,
    transactions: await Promise.all(transactions.map((transaction, index) => readTransaction(transaction, index + 1, currency, accountKey, origin))),
  }
}

/**
 * Says why no statement can be read on this page, or null where one can
 *
 * Browsers only offer crypto.subtle, which the bank transaction hash is made with, and
 * crypto.randomUUID, which tells files apart, to a page on HTTPS or localhost. A self-hosted server
 * can be opened over plain HTTP by its IP address, where every file would otherwise fail to read
 */
export function getOfxReadBlock(): ImportUploadBlock | null {
  return globalThis.isSecureContext ? null : { message: OFX_INSECURE_CONNECTION_BLOCK, isFailure: true }
}

/**
 * Hashes the bank account a statement names with the bank's ID for one of its transactions, as
 * SHA-256 over their UTF-8 bytes joined by a zero byte, written as lower-case hex
 *
 * The backend keys this digest with its own secret, and the migration that introduced the hash
 * builds the same in SQL for transactions saved before, so changing how it is built leaves those
 * unmatched until a migration rebuilds them. Only reachable where getOfxReadBlock allows reading
 */
async function hashBankTransaction(accountKey: string, fitId: string) {
  const encoder = new TextEncoder()
  const account = encoder.encode(accountKey)
  const id = encoder.encode(fitId)
  const bytes = new Uint8Array(account.length + 1 + id.length)
  bytes.set(account)
  bytes.set(id, account.length + 1)

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Tells apart statements the file gives the same name and id, such as one account's statement split
 * over two date ranges, so each keeps its own account answer and its own line in the account step
 */
function nameStatements(statements: OfxStatement[]) {
  const seen = new Map<string, number>()
  return statements.map((statement) => {
    const count = (seen.get(statement.id) ?? 0) + 1
    seen.set(statement.id, count)
    if (count === 1) return statement
    return { ...statement, id: `${statement.id}#${count}`, name: `${statement.name} (${count})`, label: `${statement.label} (${count})` }
  })
}

/**
 * The currency a transaction's amount is stated in when its CURRENCY block names one other than the
 * statement's, as an upper-case code, or an empty string where the block names none. Null when the
 * transaction has no such block, or the block names the statement's own currency
 *
 * An ORIGCURRENCY block is not read: the amount stays in the statement's currency and the block
 * only records the foreign amount it was converted from
 */
function readOtherCurrency(node: OfxNode, statementCurrency: string) {
  const block = findChild(node, 'CURRENCY')
  if (!block) return null

  const code = readLeaf(block, 'CURSYM')?.toUpperCase() ?? ''
  return code === statementCurrency ? null : code
}

async function readTransaction(
  node: OfxNode,
  index: number,
  statementCurrency: string,
  accountKey: string,
  origin: OfxFileOrigin,
): Promise<OfxTransaction> {
  const postedText = readLeaf(node, 'DTPOSTED') ?? ''
  const amountText = readLeaf(node, 'TRNAMT') ?? ''
  const payeeAggregate = findChild(node, 'PAYEE')
  const payee = readLeaf(node, 'NAME') ?? (payeeAggregate ? readLeaf(payeeAggregate, 'NAME') : null)
  const fitId = readLeaf(node, 'FITID')

  return {
    index,
    ...origin,

    // A file read alone is the first of the files, until combining them orders it among the others
    fileOrder: 1,
    bankTransactionHash: fitId ? await hashBankTransaction(accountKey, fitId) : null,
    postedText,
    date: readPostedDate(postedText),
    amountText,
    amount: readAmount(amountText),
    payee: payee || null,
    memo: readLeaf(node, 'MEMO'),
    otherCurrency: readOtherCurrency(node, statementCurrency),
  }
}

/** The date a posted stamp starts with, ignoring its time and offset, or null when it is not a real date */
function readPostedDate(text: string) {
  const match = POSTED_DATE_PATTERN.exec(text)
  if (!match) return null

  const [, year, month, day] = match
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const isReal = date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day)
  return isReal ? `${year}-${month}-${day}` : null
}

/** Normalizes a signed decimal to plain text with a period and no plus sign, or null when it is not one */
function readAmount(text: string) {
  const match = AMOUNT_PATTERN.exec(text)
  if (!match) return null

  const [, sign, whole, fraction] = match
  return `${sign === '-' ? '-' : ''}${whole}${fraction === undefined ? '' : `.${fraction}`}`
}
