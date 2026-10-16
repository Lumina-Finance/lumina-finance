/**
 * Builds OFX statement files for the import tests, so a test states the transactions a file holds
 * and not the markup around them
 */

export interface StatementTransaction {
  posted: string
  amount: string
  fitId: string
  name: string
}

export const CAFE = { posted: '20240115120000', amount: '-12.50', fitId: 'A1', name: 'Corner Cafe' }
export const PAYROLL = { posted: '20240116120000', amount: '2500.00', fitId: 'A2', name: 'Payroll' }

// A version 1 file, as banks still write them: a header of plain lines and leaf tags left open
function buildTransactions(transactions: StatementTransaction[]) {
  return transactions.flatMap((transaction) => [
    '<STMTTRN>',
    '<TRNTYPE>DEBIT',
    `<DTPOSTED>${transaction.posted}`,
    `<TRNAMT>${transaction.amount}`,
    `<FITID>${transaction.fitId}`,
    // An empty tag such as a check number has no closing tag and must not swallow the tags after it
    '<CHECKNUM>',
    `<NAME>${transaction.name}`,
    '</STMTTRN>',
  ])
}

/** The checking account ending 6789 */
export function buildBankMessageSet(currency: string, transactions: StatementTransaction[]) {
  return [
    '<BANKMSGSRSV1><STMTTRNRS><STMTRS>',
    `<CURDEF>${currency}`,
    '<BANKACCTFROM><BANKID>123000456<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>',
    '<BANKTRANLIST>', ...buildTransactions(transactions), '</BANKTRANLIST>',
    '</STMTRS></STMTTRNRS></BANKMSGSRSV1>',
  ]
}

/** The credit card ending 1111 */
export function buildCardMessageSet(currency: string, transactions: StatementTransaction[]) {
  return [
    '<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>',
    `<CURDEF>${currency}`,
    '<CCACCTFROM><ACCTID>4111111111111111</CCACCTFROM>',
    '<BANKTRANLIST>', ...buildTransactions(transactions), '</BANKTRANLIST>',
    '</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>',
  ]
}

export function buildFile(messageSets: string[][]) {
  return [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252',
    'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', ...messageSets.flat(), '</OFX>',
  ].join('\r\n')
}

/** A file to choose in the upload, holding one CAD statement of the checking account */
export function statementFile(name: string, transactions: StatementTransaction[]) {
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(buildFile([buildBankMessageSet('CAD', transactions)])) }
}
