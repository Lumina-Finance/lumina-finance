import type { AccountType } from '@/api/accounts'
import type { ImportFileType } from '@/pages/imports/utils/fileIntake'

const MIB = 1024 * 1024

/** Largest statement the import reads, checked before the file is decoded */
export const MAX_OFX_FILE_BYTES = 25 * MIB

/** Said when a file is refused for what it is, so the next step is to choose a statement */
export const OFX_FILE_GUIDANCE = 'Choose an OFX or QFX statement from your bank.'

export const OFX_NOT_READABLE_REASON = `This isn't an OFX or QFX statement. ${OFX_FILE_GUIDANCE}`
export const OFX_TOO_LARGE_REASON = `This file is larger than ${MAX_OFX_FILE_BYTES / MIB} MB, which is more than a statement holds. ${OFX_FILE_GUIDANCE}`
export const OFX_STATEMENT_INCOMPLETE_REASON =
  "A statement in this file has no account number or currency, so it can't be imported."
export const OFX_ONLY_LEFT_OUT_REASON = "This file only holds investment statements, which aren't imported."
export const OFX_NO_STATEMENTS_REASON = `This file has no bank, credit card or loan statements. ${OFX_FILE_GUIDANCE}`

export const OFX_IMPORT_FILE_TYPE: ImportFileType = {
  matches: (file) => /\.(ofx|qfx)$/i.test(file.name),
  processingStatus: 'Reading statements',
  dropTitle: 'Drop statements here',
  multipleFilesReason: null,
  wrongTypeReason: OFX_FILE_GUIDANCE,
  nonFileDropReason: 'Drop OFX or QFX statements, not text or other page content.',
  directoryDropReason: `Folders cannot be uploaded. ${OFX_FILE_GUIDANCE}`,
}

/** What the progress overlay calls the upload stage */
export const OFX_UPLOAD_LABEL = 'Uploading the statements'

// The files are one import with one set of statements, so the account answers are kept under one fixed scope
export const getOfxAccountSourceScope = () => 'ofx'

/** The account type a new account is proposed with for the account type an OFX bank statement states */
export const OFX_BANK_ACCOUNT_TYPES: Record<string, { type: AccountType; label: string }> = {
  CHECKING: { type: 'checking', label: 'Checking' },
  SAVINGS: { type: 'savings', label: 'Savings' },
  MONEYMRKT: { type: 'savings', label: 'Money market' },
  CREDITLINE: { type: 'line_of_credit', label: 'Credit line' },
  CD: { type: 'term_deposit', label: 'Term deposit' },
}

/** Proposed when a bank statement states no account type, or one this app has no type for */
export const OFX_DEFAULT_BANK_ACCOUNT = { type: 'checking', label: 'Bank account' } as const

export const OFX_CREDIT_CARD_ACCOUNT = { type: 'credit_card', label: 'Credit card' } as const

/** The account type a loan statement proposes: a mortgage where the statement says so, otherwise a loan */
export const OFX_LOAN_ACCOUNT = { type: 'loan', label: 'Loan' } as const
export const OFX_MORTGAGE_ACCOUNT = { type: 'mortgage', label: 'Mortgage' } as const

/** How many trailing characters of the account number tell two accounts apart in a name */
export const OFX_ACCOUNT_NUMBER_TAIL_LENGTH = 4

export const OFX_DATE_UNREADABLE_REASON = 'The posted date is missing or is not a real date.'
export const OFX_AMOUNT_UNREADABLE_REASON = 'The amount is missing or is not a number.'

// A statement carries no categories, so each transaction files under a seeded one by its direction
export const OFX_CATEGORIES_UNAVAILABLE_ERROR =
  'The Miscellaneous and Other Income categories this import files transactions under could not be found.'

export function getOfxAmountTooPreciseReason(currency: string) {
  return `The amount has more decimal places than ${currency} has.`
}

/** Says why a transaction whose amount is in another currency than its statement is left out */
export function getOfxOtherCurrencyReason(code: string, statementCurrency: string) {
  return code
    ? `The amount is in ${code}, but the statement is in ${statementCurrency}, and the importer does not convert between them.`
    : `The amount is in a currency other than the statement's ${statementCurrency}, and the importer does not convert between them.`
}

/** Says why a transaction is left out when an earlier file of the import already holds it */
export function getOfxRepeatedTransactionReason(fileName: string) {
  return `This transaction is already in ${fileName}.`
}

/** Says why a transaction is left out when its account already holds it from an earlier import */
export function getOfxAlreadyInAccountReason(accountName: string) {
  return `This transaction is already in ${accountName}.`
}

/** Said beside Commit import while the server is asked which transactions the accounts already hold */
export const OFX_HELD_CHECK_RUNNING_MESSAGE = 'Checking which transactions are already in the account…'

/** Said beside Commit import when that question could not be answered, since nothing is committed unchecked */
export const OFX_HELD_CHECK_FAILED_MESSAGE =
  "Couldn't check which transactions are already in the account. Please try again."

/** Said of a transaction left out because an earlier one in the same file has its bank ID */
export const OFX_REPEATED_IN_FILE_REASON = 'Repeats an earlier transaction in this file.'

/** Says a statement can't go into an account kept in another currency */
export function getOfxCurrencyMismatchError(
  statementLabel: string,
  statementCurrency: string,
  accountCurrency: string,
) {
  return `The statement for ${statementLabel} is in ${statementCurrency}, but the account you chose is in ${accountCurrency}. Choose an account in ${statementCurrency}.`
}

/** Says a statement can't go into the account the import was started from, which is kept in another currency */
export function getOfxFixedAccountCurrencyError(
  statementCurrency: string,
  accountName: string,
  accountCurrency: string,
) {
  return `This statement is in ${statementCurrency}, but ${accountName} is in ${accountCurrency}. Import it into an account in ${statementCurrency} from the Imports page in Settings.`
}

/** Says why a file is refused on an account's own import page, which takes one statement */
export function getOfxMultipleStatementsReason(statementCount: number) {
  return `This file holds ${statementCount} statements. Import it from the Imports page in Settings, where each statement can go to its own account.`
}

/** Says what the files hold that the import leaves out */
export function getOfxLeftOutNotice({ investment }: { investment: number }, fileCount: number) {
  if (investment === 0) return null

  return `${investment} investment ${investment === 1 ? 'statement' : 'statements'} in ${fileCount === 1 ? 'this file' : 'these files'} ${investment === 1 ? "isn't" : "aren't"} imported: only bank, credit card and loan statements are supported.`
}
