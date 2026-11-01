import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { JOURNAL_NO_CATEGORY_MONEY_IN_SOURCE, JOURNAL_NO_CATEGORY_SOURCE } from '@/api/provider-imports'
import type { TransactionImportPayload } from '@/api/transaction-imports'
import {
  getImportMerchantTooLongReason,
  getImportNoRowsError,
  getRowNotesTooLongReason,
  JOURNAL_ROW_FIELD_MAX_LENGTHS,
  MAX_IMPORT_NOTES_LENGTH,
  ROW_AMOUNT_TOO_LARGE_REASON,
} from '@/pages/imports/constants'
import {
  getOfxAlreadyInAccountReason,
  getOfxAmountTooPreciseReason,
  getOfxCurrencyMismatchError,
  getOfxFixedAccountCurrencyError,
  getOfxOtherCurrencyReason,
  getOfxRepeatedTransactionReason,
  OFX_AMOUNT_UNREADABLE_REASON,
  OFX_CATEGORIES_UNAVAILABLE_ERROR,
  OFX_DATE_UNREADABLE_REASON,
  OFX_REPEATED_IN_FILE_REASON,
} from '@/pages/imports/ofx/constants'
import type { OfxFile, OfxSkippedRow, OfxStatement, OfxTransaction } from '@/pages/imports/ofx/types'
import type { ImportAccountCreateDetails } from '@/pages/imports/types'
import {
  buildImportAccountMapping,
  findUnnamedSourceCategory,
  getPreviewDateLabel,
  toImportMinorUnits,
} from '@/pages/imports/utils'
import { findCurrencyExponent } from '@/utils/moneyInput'

/** Every answer the user gives that decides where the statements go */
export interface OfxImportAnswers {
  accountMappings: Record<string, string>
  accountCreateDetails: Record<string, ImportAccountCreateDetails>
  accountById: Map<string, AccountsOverview>

  /** The account an import started from its page writes the statement to, null where each statement picks its own */
  fixedAccount?: AccountsOverview | null

  /** Undefined while the categories are still loading */
  categories: Category[] | undefined
  currencies: Currency[]

  /**
   * The skipped-row ids of the transactions the server says their account already holds, left out
   * like a repeat within the import. Undefined where nothing is known to be held
   */
  heldRowIds?: ReadonlySet<string>
}

export interface OfxImportBuild {
  errors: string[]

  /** The refusals for a statement whose currency is not its account's, which the account step lists in full */
  currencyMismatches: string[]

  /** Null until the answers leave nothing to refuse */
  payload: TransactionImportPayload | null

  /** Transactions the import leaves out, in the order the file lists them */
  skippedRows: OfxSkippedRow[]

  /** The statements a row is written for, which are the accounts the import creates when answered so */
  writtenSources: Set<string>
}

/** The statements the account step lists: those holding at least one transaction */
export function getOfxStatementsToImport(file: OfxFile) {
  return file.statements.filter((statement) => statement.transactions.length > 0)
}

/**
 * Answers every statement with the account an import started from its page
 *
 * The page takes one statement from each file, so the statements here are one per file and all of
 * them belong to that account. A file of several statements is refused when it is staged, since its
 * statements may belong to different accounts and the page has no step to tell them apart
 */
export function getOfxFixedAccountMappings(statements: OfxStatement[], fixedAccount: AccountsOverview) {
  return Object.fromEntries(statements.map((statement) => [statement.id, fixedAccount.id]))
}

export function getOfxSkippedRowId(statement: OfxStatement, transaction: OfxTransaction) {
  return `${statement.id}-${transaction.index}`
}

/**
 * Builds the payload the shared import save takes from the statements and the account answers
 *
 * A statement is written to the account its answer names, in that account's currency, so one whose
 * currency differs is refused rather than converted. A statement that states no currency, as a QIF
 * account states none, takes the account's. Transactions the file leaves unreadable, that
 * the importer could not store, whose bank ID an earlier transaction of the import already has, or
 * that the server says their account already holds, are left out and listed with the reason. The
 * rest import with their bank IDs, which the save hashes and again leaves out what the account holds
 * by then. Nothing sent names the account number: each statement's answer goes by its position in
 * the import.
 * A statement carries no categories, so money out is filed under the seeded Miscellaneous category
 * and money in under the seeded Other Income one, as a CSV row with no category is
 */
export function buildOfxImportPayload(file: OfxFile, answers: OfxImportAnswers): OfxImportBuild {
  const errors: string[] = []
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  const accounts: TransactionImportPayload['accounts'] = []
  const rows: TransactionImportPayload['rows'] = []
  const skippedRows: OfxSkippedRow[] = []
  const writtenSources = new Set<string>()
  const currencyMismatches: string[] = []

  const prepared = getOfxStatementsToImport(file).map((statement, position) => {
    // Named by position rather than by the statement's id, which holds the account number that only
    // goes to the server inside a transaction, to be hashed. The same files give the same positions,
    // so a resent upload matches
    const source = `statement-${position + 1}`
    const built = buildImportAccountMapping(
      {
        source,
        label: statement.label,
        name: statement.name,
        choice: answers.accountMappings[statement.id] ?? '',
        createDetails: answers.accountCreateDetails[statement.id],
        accountById: answers.accountById,
        takesRows: true,
        refusesGroupAccount: true,
      },
      addError,
    )

    // The account's currency decides how many decimal places an amount may carry, so nothing is
    // judged against one that is unanswered or is not the statement's. A statement that states no
    // currency takes its account's, so it never differs from it
    const accountCurrency = (built?.account?.currency ?? built?.mapping.create?.currency ?? '').toUpperCase()
    const currency = statement.currency ?? accountCurrency
    const isWritable = built !== null && accountCurrency === currency
    if (built && !isWritable) {
      const mismatch = answers.fixedAccount
        ? getOfxFixedAccountCurrencyError(currency, answers.fixedAccount.name, accountCurrency)
        : getOfxCurrencyMismatchError(statement.label, currency, accountCurrency)
      currencyMismatches.push(mismatch)
      addError(mismatch)
    }

    const exponent = isWritable ? findCurrencyExponent(answers.currencies, currency) : null
    return { statement, source, built, isWritable, exponent, currency }
  })
  const firstCopies = findFirstOfxCopies(prepared)

  for (const { statement, source, built, isWritable, exponent, currency } of prepared) {
    let hasRows = false
    for (const transaction of statement.transactions) {
      const skip = (reason: string) =>
        skippedRows.push({
          id: getOfxSkippedRowId(statement, transaction),
          fileName: transaction.fileName,
          statementLabel: statement.label,
          postedLabel: transaction.date ? getPreviewDateLabel(transaction.date) : transaction.postedText,
          amountText: transaction.amountText,
          payee: transaction.payee,
          memo: transaction.memo,
          reason,
        })

      const problem = getOfxTransactionProblem(transaction, exponent, currency)
      if (problem) {
        skip(problem)
        continue
      }

      if (!isWritable) continue

      const repeatKey = getOfxRepeatKey(statement, transaction)
      const firstCopy = repeatKey === null ? undefined : firstCopies.get(repeatKey)
      if (firstCopy !== undefined && firstCopy !== transaction) {
        skip(
          firstCopy.fileId === transaction.fileId
            ? OFX_REPEATED_IN_FILE_REASON
            : getOfxRepeatedTransactionReason(firstCopy.fileName),
        )
        continue
      }

      // Checked after the repeats, so only the copy the import keeps is judged against the account
      if (answers.heldRowIds?.has(getOfxSkippedRowId(statement, transaction))) {
        skip(getOfxAlreadyInAccountReason(built?.account?.name ?? statement.name))
        continue
      }

      hasRows = true
      rows.push({
        account_source: source,
        category_source: getOfxCategorySource(transaction),
        dt: transaction.date!,
        amount: transaction.amount!,
        merchant_name: transaction.payee,
        notes: transaction.memo,
        tag_names: [],
        bank_account: transaction.bankTransactionId === null ? null : transaction.bankAccountKey,
        bank_transaction: transaction.bankTransactionId,
      })
    }

    if (hasRows && built) {
      accounts.push(built.mapping)
      writtenSources.add(statement.id)
    }
  }

  const categories = buildCategoryMappings(rows, answers.categories, addError)
  if (errors.length === 0 && rows.length === 0) addError(getImportNoRowsError('file'))

  const payload = errors.length === 0 ? { accounts, categories, merchants: [], rows } : null
  return { errors, currencyMismatches, payload, skippedRows, writtenSources }
}

/**
 * What tells one bank transaction from another across the import: the bank's ID with the bank
 * account it was issued for, in the statement's currency, or null for a transaction the file gave
 * no ID. Held in the browser only to find repeats, and never sent
 */
function getOfxRepeatKey(statement: OfxStatement, transaction: OfxTransaction) {
  return transaction.bankTransactionId === null
    ? null
    : JSON.stringify([transaction.bankAccountKey, transaction.bankTransactionId, statement.currency])
}

/**
 * Finds the copy of each bank transaction that the import keeps, which is the first one in the
 * earliest file. Only a copy that is written counts, so one left out for a problem of its own does
 * not hide a readable copy later in the import
 */
function findFirstOfxCopies(
  prepared: Array<{ statement: OfxStatement; isWritable: boolean; exponent: number | null; currency: string }>,
) {
  const firstCopies = new Map<string, OfxTransaction>()
  for (const { statement, isWritable, exponent, currency } of prepared) {
    if (!isWritable) continue

    for (const transaction of statement.transactions) {
      const key = getOfxRepeatKey(statement, transaction)
      if (key === null || getOfxTransactionProblem(transaction, exponent, currency) !== null) continue

      const first = firstCopies.get(key)
      if (first === undefined || transaction.fileOrder < first.fileOrder) firstCopies.set(key, transaction)
    }
  }
  return firstCopies
}

/** The category source a transaction files under, by the direction of its money */
export function getOfxCategorySource(transaction: Pick<OfxTransaction, 'amount'>) {
  return transaction.amount?.startsWith('-') ? JOURNAL_NO_CATEGORY_SOURCE : JOURNAL_NO_CATEGORY_MONEY_IN_SOURCE
}

/**
 * Says why a transaction cannot be imported, or null when it can
 *
 * @param exponent - Decimal places of the account's currency, null while it is not known, which
 *   leaves the amount's precision unjudged
 */
export function getOfxTransactionProblem(transaction: OfxTransaction, exponent: number | null, currency: string) {
  if (transaction.otherCurrency !== null) return getOfxOtherCurrencyReason(transaction.otherCurrency, currency)
  if (transaction.readProblem) return transaction.readProblem
  if (transaction.date === null) return OFX_DATE_UNREADABLE_REASON
  if (transaction.amount === null) return OFX_AMOUNT_UNREADABLE_REASON

  if (exponent !== null) {
    const minorUnits = toImportMinorUnits(transaction.amount, exponent)
    if (minorUnits === 'tooPrecise') return getOfxAmountTooPreciseReason(currency)
    if (minorUnits === 'tooLarge') return ROW_AMOUNT_TOO_LARGE_REASON
  }

  // Counted in characters, as the API counts them, rather than in UTF-16 units
  if (transaction.memo && [...transaction.memo].length > MAX_IMPORT_NOTES_LENGTH) {
    return getRowNotesTooLongReason([...transaction.memo].length)
  }
  if (transaction.payee && [...transaction.payee].length > JOURNAL_ROW_FIELD_MAX_LENGTHS.merchantName) {
    return getImportMerchantTooLongReason([...transaction.payee].length)
  }
  return null
}

function buildCategoryMappings(
  rows: TransactionImportPayload['rows'],
  categories: Category[] | undefined,
  addError: (message: string) => void,
): TransactionImportPayload['categories'] {
  const sources = [JOURNAL_NO_CATEGORY_SOURCE, JOURNAL_NO_CATEGORY_MONEY_IN_SOURCE].filter((source) =>
    rows.some((row) => row.category_source === source),
  )

  const mappings: TransactionImportPayload['categories'] = []
  for (const source of sources) {
    const category = categories ? findUnnamedSourceCategory(source, categories) : null
    if (category) mappings.push({ source, category_id: category.id })
    else addError(OFX_CATEGORIES_UNAVAILABLE_ERROR)
  }
  return mappings
}
