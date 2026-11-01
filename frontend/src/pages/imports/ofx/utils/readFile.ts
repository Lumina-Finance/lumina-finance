import {
  MAX_OFX_FILE_BYTES,
  OFX_ACCOUNT_NUMBER_TAIL_LENGTH,
  OFX_BANK_ACCOUNT_TYPES,
  OFX_CREDIT_CARD_ACCOUNT,
  OFX_DEFAULT_BANK_ACCOUNT,
  OFX_LOAN_ACCOUNT,
  OFX_MORTGAGE_ACCOUNT,
  OFX_NO_STATEMENTS_REASON,
  OFX_NOT_READABLE_REASON,
  OFX_ONLY_LEFT_OUT_REASON,
  OFX_STATEMENT_INCOMPLETE_REASON,
  OFX_TOO_LARGE_REASON,
} from '@/pages/imports/ofx/constants'
import type { OfxFileRead, OfxStatement, OfxStatementKind, OfxTransaction } from '@/pages/imports/ofx/types'
import { MINUS_CHARACTERS } from '@/pages/imports/utils/amountFormats'
import { createRandomId } from '@/utils/randomId'
import { findAllDescendants, findChild, parseOfxMarkup, readLeaf, type OfxNode } from './markup'

// The 1.x header is plain ASCII lines before the markup, so a prefix is enough to find its charset
const HEADER_PREFIX_BYTES = 1024
// The encoding a 2.x file declares in its XML declaration
const XML_ENCODING_PATTERN = /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([^"']+)["']/i
const POSTED_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})/

// A plain signed decimal. OFX writes the decimal separator as a period or a comma and never groups.
// Any dash a bank or spreadsheet writes as a minus is one, as in the CSV import, since one taken for
// text would bring money out in as money in
const AMOUNT_PATTERN = new RegExp(`^([+${MINUS_CHARACTERS}]?)(\\d+)(?:[.,](\\d+))?$`, 'u')
const PLUS_SIGN = '+'

const CURRENCY_PATTERN = /^[A-Z]{3}$/

// The message set whose statements the import leaves out, holding one response per statement
const INVESTMENT_MESSAGE_SET = 'INVSTMTMSGSRSV1'

// The elements each kind of statement is read from. A loan statement states its transactions and
// account number under names of its own, and otherwise reads like a bank statement
const STATEMENT_ELEMENTS: Record<
  OfxStatementKind,
  { response: string; account: string; accountNumber: string; transaction: string }
> = {
  bank: { response: 'STMTRS', account: 'BANKACCTFROM', accountNumber: 'ACCTID', transaction: 'STMTTRN' },
  creditCard: { response: 'CCSTMTRS', account: 'CCACCTFROM', accountNumber: 'ACCTID', transaction: 'STMTTRN' },
  loan: { response: 'LOANSTMTRS', account: 'LOANACCTFROM', accountNumber: 'LOANACCTID', transaction: 'LOANSTMTTRN' },
}

/**
 * Reads an OFX file into the bank, credit card and loan statements it holds
 *
 * Investment statements are counted and left out. A statement with no account number or
 * currency refuses the file, since it could not be matched to an account or kept in the right
 * currency. A transaction whose date or amount cannot be read is kept with that value null, so the
 * import lists it as skipped instead of refusing the file
 *
 * @param file - The uploaded file, sent nowhere as it is. Each transaction carries the bank account
 * and bank ID it names, which the import sends to the server to be hashed there
 * @param fileId - What tells this file's transactions from those of another file of the same name
 */
export async function readOfxFile(file: File, fileId: string = createRandomId()): Promise<OfxFileRead> {
  if (file.size > MAX_OFX_FILE_BYTES) return { status: 'refused', reason: OFX_TOO_LARGE_REASON }

  // A file the reader cannot get through is refused as not a statement, as a crash would otherwise
  // leave the upload with no word on why it did nothing
  try {
    return readOfxStatements(decodeOfxBytes(await file.arrayBuffer()), { fileId, fileName: file.name })
  } catch {
    return { status: 'refused', reason: OFX_NOT_READABLE_REASON }
  }
}

/** The file a statement is read from, which each of its transactions records */
type OfxFileOrigin = Pick<OfxTransaction, 'fileId' | 'fileName'>

function readOfxStatements(text: string, origin: OfxFileOrigin): OfxFileRead {
  const root = parseOfxMarkup(text)
  if (!root) return { status: 'refused', reason: OFX_NOT_READABLE_REASON }

  const leftOut = { investment: countStatementResponses(root, INVESTMENT_MESSAGE_SET) }
  const sections = (Object.keys(STATEMENT_ELEMENTS) as OfxStatementKind[]).flatMap((kind) =>
    findAllDescendants(root, STATEMENT_ELEMENTS[kind].response).map((node) => ({ kind, node })),
  )

  const statements: OfxStatement[] = []
  for (const { kind, node } of sections) {
    const statement = readStatement(kind, node, origin)
    if (!statement) return { status: 'refused', reason: OFX_STATEMENT_INCOMPLETE_REASON }
    statements.push(statement)
  }

  if (statements.length === 0) {
    return { status: 'refused', reason: leftOut.investment > 0 ? OFX_ONLY_LEFT_OUT_REASON : OFX_NO_STATEMENTS_REASON }
  }

  return { status: 'read', file: { statements: mergeStatements(statements), leftOut } }
}

/**
 * Decodes the file as UTF-8, or as the charset its header declares
 *
 * A 1.x header writes a Windows code page as its number (1252) and any other charset by name
 * (ISO-8859-1), and says NONE where the text is UTF-8. A 2.x file declares its encoding in the XML
 * declaration instead. A charset the browser cannot decode is read as UTF-8
 */
function decodeOfxBytes(bytes: ArrayBuffer) {
  const header = new TextDecoder('latin1').decode(bytes.slice(0, HEADER_PREFIX_BYTES))
  const charset = (/^CHARSET:\s*(\S+)/im.exec(header) ?? XML_ENCODING_PATTERN.exec(header))?.[1]?.toLowerCase()
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

function readStatement(kind: OfxStatementKind, node: OfxNode, origin: OfxFileOrigin): OfxStatement | null {
  const currency = readLeaf(node, 'CURDEF')?.toUpperCase()
  const elements = STATEMENT_ELEMENTS[kind]
  const account = findChild(node, elements.account)
  const accountNumber = account && readLeaf(account, elements.accountNumber)
  if (!currency || !CURRENCY_PATTERN.test(currency) || !account || !accountNumber) return null

  const accountKind = readAccountKind(kind, account)
  const bankId = kind === 'bank' ? readLeaf(account, 'BANKID') : null
  const tail = accountNumber.replace(/[^A-Za-z0-9]/g, '').slice(-OFX_ACCOUNT_NUMBER_TAIL_LENGTH)
  const name = `${accountKind.label} ending ${tail || accountNumber}`

  // It tells statements of one bank account apart from another's while the files are combined, and
  // goes to the server with each transaction's bank ID, which hashes the pair before keeping anything.
  // The statement itself is sent under its position, so no account number names an answer
  const accountKey = [kind, bankId, accountNumber].filter(Boolean).join(':')
  const transactions = findAllDescendants(node, elements.transaction)
  return {
    id: accountKey,
    kind,
    name,
    label: `${name} (${currency})`,
    proposedType: accountKind.type,
    currency,
    transactions: transactions.map((transaction, index) =>
      readTransaction(transaction, index + 1, currency, accountKey, origin),
    ),
  }
}

/** The kind of account a statement proposes, from the account type it states where this app has a type for it */
function readAccountKind(kind: OfxStatementKind, account: OfxNode) {
  if (kind === 'creditCard') return OFX_CREDIT_CARD_ACCOUNT
  if (kind === 'loan')
    return readLeaf(account, 'LOANACCTTYPE')?.toUpperCase() === 'MORTGAGE' ? OFX_MORTGAGE_ACCOUNT : OFX_LOAN_ACCOUNT

  return OFX_BANK_ACCOUNT_TYPES[readLeaf(account, 'ACCTTYPE')?.toUpperCase() ?? ''] ?? OFX_DEFAULT_BANK_ACCOUNT
}

/**
 * Joins the statements a file gives the same account id and currency into one, such as one account's
 * statement split over two date ranges, so the account is answered once and counts as one statement,
 * as `combineOfxFiles` treats the same account in several files. The transactions are numbered afresh
 * in the order the file lists them
 *
 * A statement in another currency keeps the account's id, since `combineOfxFiles` tells the currencies
 * apart once the files are joined, and a later file finds its own by that id
 */
function mergeStatements(statements: OfxStatement[]) {
  const merged = new Map<string, OfxStatement>()
  for (const statement of statements) {
    const key = `${statement.id}|${statement.currency ?? ''}`
    const existing = merged.get(key)
    if (existing) {
      const after = existing.transactions.length
      existing.transactions.push(
        ...statement.transactions.map((transaction, position) => ({ ...transaction, index: after + position + 1 })),
      )
      continue
    }

    merged.set(key, statement)
  }
  return [...merged.values()]
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

function readTransaction(
  node: OfxNode,
  index: number,
  statementCurrency: string,
  accountKey: string,
  origin: OfxFileOrigin,
): OfxTransaction {
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
    bankAccountKey: accountKey,
    bankTransactionId: fitId || null,
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
  const isReal =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  return isReal ? `${year}-${month}-${day}` : null
}

/** Normalizes a signed decimal to plain text with a period and no plus sign, or null when it is not one */
function readAmount(text: string) {
  const match = AMOUNT_PATTERN.exec(text)
  if (!match) return null

  const [, sign, whole, fraction] = match
  const isMinus = sign !== '' && sign !== PLUS_SIGN
  return `${isMinus ? '-' : ''}${whole}${fraction === undefined ? '' : `.${fraction}`}`
}
