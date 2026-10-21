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
  kind?: 'bank' | 'creditCard' | 'loan'
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
  const { kind = 'bank' } = statement
  const defaultAccountIds = { bank: '000123456789', creditCard: '4111111111111111', loan: '000555666777' }
  const accountId = statement.accountId === undefined ? defaultAccountIds[kind] : statement.accountId
  const markup = {
    bank: { account: 'BANKACCTFROM', response: 'STMTRS', transactionResponse: 'STMTTRNRS', messageSet: 'BANKMSGSRSV1', list: 'BANKTRANLIST', transaction: 'STMTTRN', type: 'TRNTYPE' },
    creditCard: { account: 'CCACCTFROM', response: 'CCSTMTRS', transactionResponse: 'CCSTMTTRNRS', messageSet: 'CREDITCARDMSGSRSV1', list: 'BANKTRANLIST', transaction: 'STMTTRN', type: 'TRNTYPE' },
    loan: { account: 'LOANACCTFROM', response: 'LOANSTMTRS', transactionResponse: 'LOANSTMTTRNRS', messageSet: 'LOANMSGSRSV1', list: 'LOANTRANLIST', transaction: 'LOANSTMTTRN', type: 'LOANTRNTYPE' },
  }[kind]
  const accountLeaves = {
    bank: leaf('BANKID', '123000456', close) + leaf('ACCTID', accountId, close) + leaf('ACCTTYPE', statement.accountType ?? 'CHECKING', close),
    creditCard: leaf('ACCTID', accountId, close),
    loan: leaf('LOANACCTID', accountId, close) + leaf('LOANACCTTYPE', statement.accountType ?? 'AUTO', close),
  }[kind]
  const transactions = statement.transactions.map((transaction, index) => (
    `<${markup.transaction}>\n`
    + leaf(markup.type, kind === 'loan' ? 'PAYMENT' : 'DEBIT', close)
    + leaf('DTPOSTED', transaction.posted ?? '20240115120000', close)
    + leaf('TRNAMT', transaction.amount ?? '-12.50', close)
    + leaf('FITID', transaction.fitId === undefined ? String(index + 1) : transaction.fitId, close)
    + (transaction.extra ?? '')
    + leaf('NAME', transaction.name, close)
    + leaf('MEMO', transaction.memo, close)
    + `</${markup.transaction}>\n`
  )).join('')
  const currency = statement.currency === undefined ? 'CAD' : statement.currency

  return `<${markup.messageSet}>\n<${markup.transactionResponse}>\n${leaf('TRNUID', '1001', close)}<STATUS>\n${leaf('CODE', '0', close)}</STATUS>\n`
    + `<${markup.response}>\n${leaf('CURDEF', currency, close)}<${markup.account}>\n${accountLeaves}</${markup.account}>\n`
    + `<${markup.list}>\n${leaf('DTSTART', '20240101', close)}${leaf('DTEND', '20240131', close)}${transactions}</${markup.list}>\n`
    + `</${markup.response}>\n</${markup.transactionResponse}>\n</${markup.messageSet}>\n`
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

/** A message set the import leaves out, holding the given number of investment statement responses */
export function buildInvestmentMessageSet(responseCount: number) {
  const responses = Array.from({ length: responseCount }, () => '<INVSTMTTRNRS>\n<TRNUID>2001\n</INVSTMTTRNRS>\n').join('')
  return `<INVSTMTMSGSRSV1>\n${responses}</INVSTMTMSGSRSV1>\n`
}

export function toOfxFile(contents: string | Uint8Array, name = 'statement.ofx') {
  return new File([contents as BlobPart], name)
}
