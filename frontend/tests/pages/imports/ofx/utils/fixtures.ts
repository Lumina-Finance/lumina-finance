/**
 * OFX files written the two ways banks write them, for the tests of the OFX import
 *
 * Version 1.x is SGML: a header of plain lines, then tags whose leaf elements have no closing tag.
 * Version 2.x is XML with every element closed. Both builders take the same transactions, so a test
 * can check that the two spellings of one statement read the same
 */

export interface FixtureTransaction {
  posted?: string
  amount?: string

  /**
   * Null writes no FITID, as a bank that gives its transactions no ID. Left out, each transaction
   * gets its own, its position in the statement, so a statement never repeats an ID by accident
   */
  fitId?: string | null
  name?: string
  memo?: string

  /** Markup written between the FITID and the payee, such as an empty tag or a currency block */
  extra?: string
}

export interface FixtureStatement {
  kind?: 'bank' | 'creditCard'
  currency?: string | null
  accountId?: string | null
  accountType?: string
  transactions: FixtureTransaction[]
}

export const SGML_HEADER = [
  'OFXHEADER:100',
  'DATA:OFXSGML',
  'VERSION:102',
  'SECURITY:NONE',
  'ENCODING:USASCII',
  'CHARSET:1252',
  'COMPRESSION:NONE',
  'OLDFILEUID:NONE',
  'NEWFILEUID:NONE',
  '',
].join('\r\n')

export const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>\n'

/** Writes one leaf element, closed in XML and open in SGML, or nothing for a value left out */
function leaf(tag: string, value: string | null | undefined, close: boolean) {
  if (value === null || value === undefined) return ''
  return close ? `<${tag}>${value}</${tag}>\n` : `<${tag}>${value}\n`
}

/** The message set holding one statement, with leaf elements closed or left open */
export function buildMessageSet(statement: FixtureStatement, close: boolean) {
  const isCard = statement.kind === 'creditCard'
  const accountId = statement.accountId === undefined ? (isCard ? '4111111111111111' : '000123456789') : statement.accountId
  const account = isCard ? 'CCACCTFROM' : 'BANKACCTFROM'
  const accountLeaves = isCard
    ? leaf('ACCTID', accountId, close)
    : leaf('BANKID', '123000456', close) + leaf('ACCTID', accountId, close) + leaf('ACCTTYPE', statement.accountType ?? 'CHECKING', close)
  const transactions = statement.transactions.map((transaction, index) => (
    '<STMTTRN>\n'
    + leaf('TRNTYPE', 'DEBIT', close)
    + leaf('DTPOSTED', transaction.posted ?? '20240115120000', close)
    + leaf('TRNAMT', transaction.amount ?? '-12.50', close)
    + leaf('FITID', transaction.fitId === undefined ? String(index + 1) : transaction.fitId, close)
    + (transaction.extra ?? '')
    + leaf('NAME', transaction.name, close)
    + leaf('MEMO', transaction.memo, close)
    + '</STMTTRN>\n'
  )).join('')
  const response = isCard ? 'CCSTMTRS' : 'STMTRS'
  const transactionResponse = isCard ? 'CCSTMTTRNRS' : 'STMTTRNRS'
  const messageSet = isCard ? 'CREDITCARDMSGSRSV1' : 'BANKMSGSRSV1'
  const currency = statement.currency === undefined ? 'CAD' : statement.currency

  return `<${messageSet}>\n<${transactionResponse}>\n${leaf('TRNUID', '1001', close)}<STATUS>\n${leaf('CODE', '0', close)}</STATUS>\n`
    + `<${response}>\n${leaf('CURDEF', currency, close)}<${account}>\n${accountLeaves}</${account}>\n`
    + `<BANKTRANLIST>\n${leaf('DTSTART', '20240101', close)}${leaf('DTEND', '20240131', close)}${transactions}</BANKTRANLIST>\n`
    + `</${response}>\n</${transactionResponse}>\n</${messageSet}>\n`
}

/** Wraps message sets in the sign-on a file opens with */
export function wrapMessageSets(messageSets: string[], header = SGML_HEADER, close = false) {
  return `${header}<OFX>\n<SIGNONMSGSRSV1>\n<SONRS>\n<STATUS>\n${leaf('CODE', '0', close)}</STATUS>\n${leaf('DTSERVER', '20240201', close)}</SONRS>\n</SIGNONMSGSRSV1>\n${messageSets.join('')}</OFX>\n`
}

/** An OFX 1.x file: leaf elements left open */
export function buildSgmlOfx(statements: FixtureStatement[]) {
  return wrapMessageSets(statements.map((statement) => buildMessageSet(statement, false)))
}

/** An OFX 2.x file: every element closed */
export function buildXmlOfx(statements: FixtureStatement[]) {
  return wrapMessageSets(statements.map((statement) => buildMessageSet(statement, true)), XML_HEADER, true)
}

/** A message set the import leaves out, holding the given number of statement responses */
export function buildLeftOutMessageSet(name: 'INVSTMTMSGSRSV1' | 'LOANMSGSRSV1', responseCount: number) {
  const response = name === 'INVSTMTMSGSRSV1' ? 'INVSTMTTRNRS' : 'LOANTRNRS'
  const responses = Array.from({ length: responseCount }, () => `<${response}>\n<TRNUID>2001\n</${response}>\n`).join('')
  return `<${name}>\n${responses}</${name}>\n`
}

export function toOfxFile(contents: string | Uint8Array, name = 'statement.ofx') {
  return new File([contents as BlobPart], name)
}
