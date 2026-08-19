import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Merchant } from '@/api/merchants'
import type { TransactionImportPayload, TransactionImportResponse } from '@/api/transaction-imports'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  getCategoryDirectionClashError,
  getDirectionValuesAgreeError,
  getTooManyMappingsError,
  getUnansweredDirectionValuesError,
  MAX_IMPORT_MAPPINGS,
  NO_OUTFLOWS_WARNING,
  ROW_SIGN_DISAGREES_WITH_CATEGORY_REASON,
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
import { isImportAccountType } from '@/pages/imports/accountTypeGuard'
import type { Currency } from '@/api/currency'
import { findReusedImportCategory, getCategoryMatchKind } from './categoryMatching'
import { buildImportMerchantMappings } from './merchantMatching'
import { getImportDirectionValues } from './columnMapping'
import { getImportRowId } from './common'
import { getAmountArrangementClashError, getMissingRequiredColumnLabels } from './workflowOptions'
import {
  getCurrencyByAccountSource,
  getImportRowProblem,
  type ImportRowContext,
  type ImportRowJudgement,
  resolveImportRow,
} from './rowResolution'
import { type ImportDateFormat, parseImportNumber } from './valueParsers'

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

  if (files.length === 0) addError('Upload at least one CSV file.')
  for (const file of files) {
    if (file.error) addError(`${file.name}: ${file.error}`)
  }

  const missingRequired = getMissingRequiredColumnLabels(columnMap)
  if (missingRequired.length > 0) addError(`Missing required columns: ${missingRequired.join(', ')}`)

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

  const mappedHeaders = new Set(Object.values(columnMap).filter(Boolean))
  for (const [header, message] of Object.entries(columnValidationErrors)) {
    if (mappedHeaders.has(header) && !columnErrors.includes(message)) columnErrors.push(message)
  }

  const accounts: TransactionImportPayload['accounts'] = []
  for (const source of accountSources) {
    const choice = accountMappings[source.id] ?? ''
    appendAccountMapping(
      accounts,
      errors,
      source,
      choice,
      accountCreateTypes[source.id],
      accountCreateCurrencies[source.id],
      accountCreateInstitutions[source.id],
      accountById,
    )
  }

  const categories: TransactionImportPayload['categories'] = []

  // Only a transfer category records where the money went, so the rule is settled per category
  // source once and read back for every row using it
  const recordsCounterpartyBySource: Record<string, boolean> = {}

  // The kind each category source settles on, read back per row to spot an amount running the other
  // way. A source mapped to an existing category takes that category's kind
  const kindByCategorySource: Record<string, ImportCategoryKind> = {}
  for (const source of importedCategories) {
    const choice = categoryMappings[source] ?? ''
    if (!choice) {
      addError(`Map category: ${source}`)
      continue
    }

    if (choice === CREATE_CATEGORY_VALUE) {
      const kind = getCategoryMatchKind('', categoryCreateKinds[source], categoryTypesBySource[source], categoryById)
      if (!kind) {
        addError(`Choose category type: ${source}`)
        continue
      }

      // A create mapping reuses a category of the same name where one exists, compared with
      // capitals folded, so the row is judged against the category it will actually land on rather
      // than against the name the file spells. That is what puts a source called BALANCE ADJUSTMENT
      // on the system category recording no counterparty account, as Balance Adjustment already is
      const reused = findReusedImportCategory(source, categoryById.values())

      // One name records one direction, so reusing it under the other is what the commit refuses.
      // Caught here instead, where the step can say which value to go and answer differently
      if (reused && reused.kind !== kind) {
        addError(getCategoryDirectionClashError(source, reused.name, reused.kind))
        continue
      }

      recordsCounterpartyBySource[source] = doesTransferRecordCounterpartyAccount(
        kind,
        (reused?.name ?? source) === BALANCE_ADJUSTMENT_CATEGORY_NAME,
      )
      kindByCategorySource[source] = kind
      categories.push({
        source,
        create: {
          name: source,
          kind,
          icon: DEFAULT_CATEGORY_ICON,
        },
      })
      continue
    }

    // The backend matches Balance Adjustment by name alone, so a personal category sharing that
    // name is refused there too and has to be refused here
    const category = categoryById.get(choice)
    recordsCounterpartyBySource[source] = category
      ? doesTransferRecordCounterpartyAccount(category.kind, category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
      : false
    if (category) kindByCategorySource[source] = category.kind
    categories.push({ source, category_id: choice })
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

      // A row can be worth a second look for more than one reason, and each is listed on its own so
      // the table says every thing that is odd about it rather than only the first
      if (doesSignDisagreeWithCategoryKind(resolved.amount, kindByCategorySource[resolved.categorySource])) {
        rowWarnings.push({
          id: getImportRowId(file.id, rowIndex),
          rowNumber: rowIndex + 1,
          cells: row,
          reason: ROW_SIGN_DISAGREES_WITH_CATEGORY_REASON,
        })
      }

      rows.push(toPayloadRow(resolved))
    }
  }

  // A file whose every row has a problem is described by the list of problems, so the empty-file
  // message is kept for the case it was written for
  if (rows.length === 0 && rowProblems.length === 0) addError('No transaction rows are available to import.')

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
 * Reports whether a row's amount moves the opposite way to the kind of category it is filed under
 *
 * A refund inside an expense category is real data, so this is only ever a warning. It is worth
 * saying because the app then counts the row two ways: cash flow reads the sign, while the category
 * total reads the kind, and the two numbers describe the same row differently
 *
 * A transfer has no direction rule anywhere in the app, and an amount of zero has no direction at
 * all, so neither is judged
 */
function doesSignDisagreeWithCategoryKind(amount: string, kind: ImportCategoryKind | undefined) {
  const value = parseImportNumber(amount)
  if (value === null || value === 0) return false

  if (kind === 'expense') return value > 0
  if (kind === 'income') return value < 0
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

  const hasOutflow = rows.some((row) => (parseImportNumber(row.amount) ?? 0) < 0)
  return hasOutflow ? [] : [NO_OUTFLOWS_WARNING]
}

function appendAccountMapping(
  accounts: TransactionImportPayload['accounts'],
  errors: string[],
  accountSource: ImportAccountSource,
  choice: string,
  createType: string | undefined,
  createCurrency: string | undefined,
  createInstitution: string | undefined,
  accountById: Map<string, AccountsOverview>,
) {
  const source = accountSource.id
  const createName = accountSource.label
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  if (!choice) {
    addError(`Map account: ${createName}`)
    return
  }

  if (choice === OUTSIDE_ACCOUNT_VALUE) {
    // The dropdown only offers this answer where no row is written to the source, so it survives
    // here when a file added later carries rows for a name that was answered this way
    if (!accountSource.isCounterpartyOnly) {
      addError(`Rows cannot be written to an account source that is outside the tracked accounts: ${createName}`)
      return
    }

    accounts.push({ source, outside: true })
    return
  }

  if (choice !== CREATE_ACCOUNT_VALUE) {
    // Only a counterparty source is offered an archived account, and pointing the account column at
    // that same column afterwards turns it into a source rows are written to while its answer
    // stands, which the dropdown no longer offers and the API refuses
    if (!accountSource.isCounterpartyOnly && accountById.get(choice)?.is_archived) {
      addError(`Rows cannot be written to an archived account: ${createName}`)
      return
    }

    accounts.push({ source, account_id: choice })
    return
  }

  if (!createType) addError(`Choose account type: ${createName}`)
  if (!createCurrency) addError(`Choose account currency: ${createName}`)
  if (!createType || !createCurrency) return

  if (!isImportAccountType(createType)) {
    addError(`Invalid account type: ${createName}`)
    return
  }

  accounts.push({
    source,
    create: {
      name: createName,
      account_type: createType,
      currency: createCurrency.toUpperCase(),
      institution_id: createInstitution || null,
    },
  })
}

/**
 * Formats a completed import's created counts into one summary line for the progress overlay
 */
export function formatImportSummary(result: TransactionImportResponse) {
  const parts = [
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} imported`,
    `${result.accounts_created} account${result.accounts_created === 1 ? '' : 's'} created`,
    `${result.categories_created} categor${result.categories_created === 1 ? 'y' : 'ies'} created`,
  ]

  return parts.join(' · ')
}

/**
 * Extracts a user-facing message from a failed import request, falling back to a generic message
 * for a non-Error rejection
 */
export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Import failed.'
}
