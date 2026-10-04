import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { TransactionImportPayload, TransactionImportResponse } from '@/api/transaction-imports'
import {
  getDirectionValuesAgreeError,
  getImportNoRowsError,
  getTooManyMappingsError,
  getRowSignDisagreesWithCategoryReason,
  getUnansweredDirectionValuesError,
  MAX_IMPORT_MAPPINGS,
  NO_OUTFLOWS_WARNING,
} from '@/pages/imports/constants'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type {
  ColumnMap,
  ColumnValidationErrors,
  ImportAccountSource,
  ImportAmountDirection,
  ImportBuildResult,
  ImportCategoryKind,
  ImportFileDraft,
  ImportRowProblem,
} from '@/pages/imports/types'
import type { Currency } from '@/api/currency'
import {
  DEFAULT_IMPORT_AMOUNT_FORMAT,
  type ImportAmountFormat,
  type ImportAmountReading,
  readNormalizedImportAmount,
} from './amountFormats'
import { getCategoryMatchKind, getDebtPaymentImportNote } from './categoryMatching'
import { buildImportAccountMapping, buildImportCategoryMapping } from './importMappings'
import { buildImportMerchantMappings } from './merchantMatching'
import { getImportDirectionValues } from './columnMapping'
import { getImportRowId, joinImportSummaryParts } from './common'
import { getAmountArrangementClashError, getMissingRequiredColumnLabels } from './workflowOptions'
import {
  getCurrencyByAccountSource,
  getImportRowProblem,
  type ImportRowContext,
  type ImportRowJudgement,
  resolveImportRow,
} from './rowResolution'
import { type ImportDateFormat, type ImportDateSeparator } from './valueParsers'

/**
 * Builds the commit payload for the generic CSV import flow from the staged files and every mapping
 * choice made so far, collecting every validation problem along the way instead of stopping at the
 * first one
 *
 * Returns the built payload only when no error was collected. A mapping or data problem instead
 * returns every accumulated error with a null payload, so the caller can show them all at once
 */
export function buildTransactionImportPayload({
  accountById,
  accountCreateCurrencies,
  accountCreateInstitutions,
  accountCreateTypes,
  accountMappings,
  accountSources,
  categoryById,
  categoryCreateKinds,
  categoryMappings,
  categoryTypesBySource,
  columnMap,
  columnValidationErrors,
  currencies,
  dateFormat,
  dateSeparator = 'automatic',
  timeZone,
  amountFormat = DEFAULT_IMPORT_AMOUNT_FORMAT,
  directionAnswers,
  files,
  importedCategories,
  merchantAnswers,
}: {
  accountById: Map<string, AccountsOverview>
  accountCreateCurrencies: Record<string, string>
  accountCreateInstitutions: Record<string, string>
  accountCreateTypes: Record<string, string>
  accountMappings: Record<string, string>
  accountSources: ImportAccountSource[]
  categoryById: Map<string, Category>
  categoryCreateKinds: Record<string, ImportCategoryKind>
  categoryMappings: Record<string, string>
  categoryTypesBySource: Record<string, string>
  columnMap: ColumnMap
  columnValidationErrors: ColumnValidationErrors
  currencies: Currency[]
  dateFormat: ImportDateFormat | null
  dateSeparator?: ImportDateSeparator
  timeZone?: string
  amountFormat?: ImportAmountFormat | null

  /** What each word in a mapped Direction column means, keyed by the folded value */
  directionAnswers: Record<string, ImportAmountDirection>
  files: ImportFileDraft[]
  importedCategories: string[]

  /**
   * What the user answered about the file's payee values, absent where no merchant column is
   * mapped and there are none to answer
   */
  merchantAnswers?: {
    importedMerchants: string[]
    matchedMerchantByKey: Map<string, Merchant>
    merchantMappings: Record<string, string>
    merchantCreateNames: Record<string, string>
  }
}): ImportBuildResult {
  // Two kinds of problem, kept apart because only one of them makes judging a row meaningless. An
  // unanswered mapping question leaves every row looking broken for want of the answer, while a
  // column whose values do not fit the field is a statement about the rows themselves, and those
  // rows are exactly what the caller lists. A column problem also leads the returned list, since it
  // quotes a value the user has to go and find, where an unanswered question is a blank the step it
  // belongs to already shows
  const errors: string[] = []
  const columnErrors: string[] = []
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  if (files.length === 0) addError('Upload a CSV file.')
  for (const file of files) {
    if (file.error) addError(`${file.name}: ${file.error}`)
  }

  const missingRequired = getMissingRequiredColumnLabels(columnMap)
  if (missingRequired.length > 0) addError(`Map the required columns: ${missingRequired.join(', ')}`)

  const arrangementClash = getAmountArrangementClashError(columnMap)
  if (arrangementClash) addError(arrangementClash.message)

  // A Direction column the mapping step has already refused, or one contradicting a side column,
  // gives no row a direction. Both are reported in their own right, and neither leaves the panel
  // where the words are answered on screen, so nothing here asks for an answer the user cannot give
  const isDirectionColumnUnusable = Boolean(columnMap.amount_direction)
    && (Boolean(columnValidationErrors[columnMap.amount_direction]) || arrangementClash !== null)

  // Asked before any row is judged, for the reason the date format is: without an answer every row
  // reads as one with no amount, which is a file full of broken rows rather than one question
  // waiting on the mapping step
  if (!isDirectionColumnUnusable) {
    for (const message of getDirectionAnswerErrors(files, columnMap, directionAnswers)) addError(message)
  }

  // Counted off the distinct values the files hold rather than the mappings answered so far, so the
  // refusal does not wait for answers that cannot change it. Mapping a thousand categories by hand
  // and only then being told the import cannot run is the whole reason this is asked here
  if (accountSources.length > MAX_IMPORT_MAPPINGS) {
    addError(getTooManyMappingsError('account', accountSources.length))
  }
  if (importedCategories.length > MAX_IMPORT_MAPPINGS) {
    addError(getTooManyMappingsError('category', importedCategories.length))
  }

  // Without a settled format every row would fail its own date check, which reads as a file full of
  // bad dates rather than one unanswered question
  if (columnMap.dt && !dateFormat) addError('Choose the date format this file is written in.')
  if ((columnMap.amount || columnMap.amount_out || columnMap.amount_in) && !amountFormat) {
    addError('Choose the amount format this file is written in.')
  }

  const mappedHeaders = new Set(Object.values(columnMap).filter(Boolean))
  for (const [header, message] of Object.entries(columnValidationErrors)) {
    if (mappedHeaders.has(header) && !columnErrors.includes(message)) columnErrors.push(message)
  }

  const accounts: TransactionImportPayload['accounts'] = []
  for (const source of accountSources) {
    const choice = accountMappings[source.id] ?? ''
    if (choice === OUTSIDE_ACCOUNT_VALUE) {
      // The dropdown only offers this answer where no row is written to the source, so it survives
      // here when a file added later carries rows for a name that was answered this way
      if (source.isCounterpartyOnly) accounts.push({ source: source.id, outside: true })
      else addError(`Map to one of your accounts: ${source.label} has rows of its own, so it cannot be answered as outside.`)
      continue
    }

    // Only a counterparty source is offered an archived or read-only account, and pointing the
    // account column at that same column afterwards turns it into a source rows are written to while
    // its answer stands, which the dropdown no longer offers and the API refuses
    const built = buildImportAccountMapping({
      source: source.id,
      label: source.label,
      name: source.label,
      choice,
      createDetails: {
        accountType: accountCreateTypes[source.id],
        currency: accountCreateCurrencies[source.id],
        institutionId: accountCreateInstitutions[source.id],
      },
      accountById,
      takesRows: !source.isCounterpartyOnly,
      refusesGroupAccount: false,
    }, addError)
    if (built) accounts.push(built.mapping)
  }

  const categories: TransactionImportPayload['categories'] = []
  const createdByKey = new Map<string, { label: string; kind: ImportCategoryKind }>()

  // Only a transfer category records where the money went, so the rule is settled per category
  // source once and read back for every row using it
  const recordsCounterpartyBySource: Record<string, boolean> = {}

  // The kind each category source settles on, read back per row to spot an amount moving the other
  // way. A source mapped to an existing category takes that category's kind
  const kindByCategorySource: Record<string, ImportCategoryKind> = {}

  // The category each source will actually use, including an existing category the create answer
  // reuses, read back only after a row passes its blocking validation
  const categoryBySource: Record<string, Category | undefined> = {}
  for (const source of importedCategories) {
    // A create answer reuses a category of the same name where one exists, compared with capitals
    // folded, so the row is judged against the category it will actually land on rather than against
    // the name the file spells. That is what puts a source called BALANCE ADJUSTMENT on the system
    // category recording no counterparty account, as Balance Adjustment already is
    const built = buildImportCategoryMapping({
      source,
      label: source,
      createName: source,
      choice: categoryMappings[source] ?? '',
      createKind: getCategoryMatchKind('', categoryCreateKinds[source], categoryTypesBySource[source], categoryById),
      rename: undefined,
      categoryById,
      createdByKey,
      refusesGroupCategory: false,
    }, addError)
    if (!built) continue

    // The backend matches Balance Adjustment by name alone, so a personal category sharing that
    // name records no counterparty here either
    recordsCounterpartyBySource[source] = built.kind !== null && doesTransferRecordCounterpartyAccount(
      built.kind,
      (built.category?.name ?? built.name) === BALANCE_ADJUSTMENT_CATEGORY_NAME,
    )
    if (built.kind) kindByCategorySource[source] = built.kind
    categoryBySource[source] = built.category
    categories.push(built.mapping)
  }

  // Only the payee values answered differently from what the commit would do unasked are carried,
  // so a file with thousands of distinct descriptors nobody touched declares none of them
  const merchants: TransactionImportPayload['merchants'] = []
  if (merchantAnswers) {
    const built = buildImportMerchantMappings(merchantAnswers)
    merchants.push(...built.mappings)
    for (const message of built.errors) addError(message)
  }

  // Judging rows before every mapping they depend on is answered blames them for the answer being
  // missing: with no category column mapped, every row reads as one with a blank category, and with
  // no date format settled, every row reads as one whose date does not fit
  //
  // An unusable Direction column is the same case reached without an entry in `errors`, since what
  // is wrong with it is reported against the column instead. Judging rows against it would list
  // every one of them as an amount that is blank, beside the Amount cells holding those amounts
  if (errors.length > 0 || isDirectionColumnUnusable) {
    return {
      errors: [...columnErrors, ...errors],
      rowProblems: [],
      warnings: [],
      rowWarnings: [],
      payload: null,
    }
  }

  const rowContext: ImportRowContext = {
    columnMap,
    dateFormat,
    dateSeparator,
    timeZone,
    amountFormat,
    directionAnswers,
    currencyByAccountSource: getCurrencyByAccountSource(accountMappings, accountById, accountCreateCurrencies),
  }
  const rowJudgement: ImportRowJudgement = { currencies, accountMappings, recordsCounterpartyBySource }

  const rows: TransactionImportPayload['rows'] = []
  const rowProblems: ImportRowProblem[] = []
  const rowWarnings: ImportRowProblem[] = []
  for (const file of files) {
    for (const [rowIndex, row] of file.rows.entries()) {
      const resolved = resolveImportRow(row, file.id, rowContext)
      const problem = getImportRowProblem(resolved, rowJudgement)
      if (problem) {
        rowProblems.push({
          id: getImportRowId(file.id, rowIndex),
          // Its position among the file's data rows, which is not the line it sits on: parsing
          // drops blank lines and folds a quoted value carrying a newline into one row
          rowNumber: rowIndex + 1,
          cells: row,
          reason: problem,
        })
        continue
      }

      // One source row keeps one warning-table identity even when more than one note applies
      const warningReasons: string[] = []
      const categoryKind = kindByCategorySource[resolved.categorySource]
      if (doesSignDisagreeWithCategoryKind(resolved.amountReading, categoryKind)) {
        // Only an expense or an income category reaches here, since the check above judges no
        // other kind, so the note can say which of the two this row is filed under
        warningReasons.push(getRowSignDisagreesWithCategoryReason(categoryKind as 'expense' | 'income'))
      }

      const debtPaymentNote = getDebtPaymentImportNote(categoryBySource[resolved.categorySource])
      if (debtPaymentNote) warningReasons.push(debtPaymentNote)

      if (warningReasons.length > 0) {
        rowWarnings.push({
          id: getImportRowId(file.id, rowIndex),
          rowNumber: rowIndex + 1,
          cells: row,
          reason: warningReasons.join(' '),
        })
      }

      rows.push(toPayloadRow(resolved))
    }
  }

  // A file whose every row has a problem is described by the list of problems, so the empty-file
  // message is kept for the case it was written for
  if (rows.length === 0 && rowProblems.length === 0) addError(getImportNoRowsError('file'))

  const warnings = getImportWarnings(rows, columnMap)
  const allErrors = [...columnErrors, ...errors]
  if (allErrors.length > 0 || rowProblems.length > 0) {
    return { errors: allErrors, rowProblems, warnings, rowWarnings, payload: null }
  }
  return {
    errors: [],
    rowProblems: [],
    warnings,
    rowWarnings,
    payload: { accounts, categories, merchants, rows },
  }
}

/**
 * Shapes one resolved row as the payload carries it
 */
function toPayloadRow(resolved: ReturnType<typeof resolveImportRow>): TransactionImportPayload['rows'][number] {
  return {
    account_source: resolved.accountSource,
    category_source: resolved.categorySource,
    dt: resolved.dt,
    amount: resolved.amount,
    merchant_name: resolved.merchantName,
    notes: resolved.notes,
    tag_names: resolved.tagNames,
    counterparty_account_source: resolved.counterpartySource,
  }
}

/**
 * Reports whether a row is money going the way its category does not usually record
 *
 * A refund inside an expense category is real data, so this is only ever a warning. It is worth
 * saying because the app then counts the row two ways: cash flow reads the sign, while the category
 * total reads the kind, and the two numbers describe the same row differently
 *
 * A transfer has no direction rule anywhere in the app, and an amount of zero has no direction at
 * all, so neither is judged
 */
function doesSignDisagreeWithCategoryKind(
  amount: ImportAmountReading | null,
  kind: ImportCategoryKind | undefined,
) {
  if (!amount || amount.isZero) return false

  if (kind === 'expense') return amount.sign !== 'negative'
  if (kind === 'income') return amount.sign === 'negative'
  return false
}

/**
 * Reports what is still wrong with the answers given for a mapped Direction column
 *
 * A word nobody answered leaves its rows with no direction, and two words answered the same way
 * leave the file with no direction at all, so both stop the commit. Neither is checked where no
 * Direction column is mapped, since there is nothing to answer, nor where the caller has already
 * found the column unusable
 */
function getDirectionAnswerErrors(
  files: ImportFileDraft[],
  columnMap: ColumnMap,
  directionAnswers: Record<string, ImportAmountDirection>,
) {
  if (!columnMap.amount_direction) return []

  const values = getImportDirectionValues(files, columnMap.amount_direction)
  if (values.length === 0) return []

  const unanswered = values.filter((value) => !directionAnswers[value.key])
  if (unanswered.length > 0) return [getUnansweredDirectionValuesError(unanswered.map((value) => value.label))]

  const answered = values.map((value) => directionAnswers[value.key])
  if (answered.length === 2 && answered[0] === answered[1]) return [getDirectionValuesAgreeError(answered[0])]

  return []
}

/**
 * Collects what is worth saying about an import that is otherwise ready to go
 *
 * A file where nothing is negative has almost certainly been read the wrong way round, so every
 * expense would import as income. It is a warning rather than a refusal because a file of nothing
 * but income is a real thing to import
 *
 * Skipped only where money in is the one amount column mapped, since every row of such a file is
 * positive whatever the data says and the warning would fire on every one of them. Every other
 * arrangement is asked, including a two-sided file whose money out column happens to be empty: that
 * is indistinguishable from the two sides being mapped the wrong way round, and a warning nobody
 * needed costs less than a month of spending imported as income
 *
 * What it cannot do is tell a file read backwards from a file that really is all inflows, so it
 * describes what the rows say rather than diagnosing which of the two it is
 */
function getImportWarnings(rows: TransactionImportPayload['rows'], columnMap: ColumnMap) {
  if (rows.length === 0) return []
  if (columnMap.amount_in && !columnMap.amount_out && !columnMap.amount) return []

  const hasOutflow = rows.some((row) => {
    const amount = readNormalizedImportAmount(row.amount)
    return amount !== null && !amount.isZero && amount.sign === 'negative'
  })
  return hasOutflow ? [] : [NO_OUTFLOWS_WARNING]
}

/**
 * Formats a completed import's created counts into the summary for the progress overlay
 */
export function formatImportSummary(result: TransactionImportResponse) {
  const parts = [
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} imported`,
    `${result.accounts_created} account${result.accounts_created === 1 ? '' : 's'} created`,
    `${result.categories_created} categor${result.categories_created === 1 ? 'y' : 'ies'} created`,
  ]

  return joinImportSummaryParts(parts)
}
