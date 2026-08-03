import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { TransactionImportPayload, TransactionImportResponse } from '@/api/transaction-imports'
import {
  COLUMN_TARGETS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  ROW_ACCOUNT_BLANK_REASON,
  ROW_AMOUNT_UNREADABLE_REASON,
  ROW_CATEGORY_BLANK_REASON,
  ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON,
  ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON,
  ROW_DATE_UNREADABLE_REASON,
} from '@/pages/imports/constants'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type {
  ColumnMap,
  ColumnValidationErrors,
  ImportAccountSource,
  ImportBuildResult,
  ImportCategoryKind,
  ImportFileDraft,
  ImportRowProblem,
} from '@/pages/imports/types'
import { isImportAccountType } from '@/pages/imports/accountTypeGuard'
import { getCategoryMatchKind, splitImportedValues } from './categoryMatching'
import { getMappedValue } from './columnMapping'
import { type ImportDateFormat, parseImportNumber, readImportDate } from './valueParsers'

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
  dateFormat,
  files,
  importedCategories,
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
  dateFormat: ImportDateFormat | null
  files: ImportFileDraft[]
  importedCategories: string[]
}): ImportBuildResult {
  const errors: string[] = []
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  if (files.length === 0) addError('Upload at least one CSV file.')
  for (const file of files) {
    if (file.error) addError(`${file.name}: ${file.error}`)
  }

  const missingRequired = COLUMN_TARGETS
    .filter((target) => target.required && !columnMap[target.id])
    .map((target) => target.label)
  if (missingRequired.length > 0) addError(`Missing required columns: ${missingRequired.join(', ')}`)

  // Without a settled format every row would fail its own date check, which reads as a file full of
  // bad dates rather than one unanswered question
  if (columnMap.dt && !dateFormat) addError('Choose the date format this file is written in.')

  const mappedHeaders = new Set(Object.values(columnMap).filter(Boolean))
  for (const [header, message] of Object.entries(columnValidationErrors)) {
    if (mappedHeaders.has(header)) addError(message)
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

      // A create mapping reuses a category of the same name where one exists, so a source called
      // Balance Adjustment lands on the system category that records no counterparty account
      recordsCounterpartyBySource[source] = doesTransferRecordCounterpartyAccount(
        kind,
        source === BALANCE_ADJUSTMENT_CATEGORY_NAME,
      )
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
    categories.push({ source, category_id: choice })
  }

  // Judging rows before every mapping they depend on is answered blames them for the answer being
  // missing: with no category column mapped, every row reads as one with a blank category, and with
  // no date format settled, every row reads as one whose date does not fit
  if (errors.length > 0) return { errors, rowProblems: [], payload: null }

  const rows: TransactionImportPayload['rows'] = []
  const rowProblems: ImportRowProblem[] = []
  for (const file of files) {
    for (const [rowIndex, row] of file.rows.entries()) {
      const accountSource = columnMap.account_id ? getMappedValue(row, columnMap.account_id) : file.id
      const categorySource = getMappedValue(row, columnMap.category_id)
      const dt = dateFormat ? readImportDate(getMappedValue(row, columnMap.dt), dateFormat) : ''
      const amount = getMappedValue(row, columnMap.amount)

      const counterpartySource = columnMap.counterparty_account_id
        ? cleanOptional(getMappedValue(row, columnMap.counterparty_account_id))
        : null

      const problem = getImportRowProblem({
        accountMappings,
        accountSource,
        amount,
        categorySource,
        counterpartySource,
        dt,
        recordsCounterpartyBySource,
      })
      if (problem) {
        rowProblems.push({
          id: `${file.id}-${rowIndex}`,
          line: getImportRowLine(file, rowIndex),
          cells: row,
          reason: problem,
        })
        continue
      }

      rows.push({
        account_source: accountSource,
        category_source: categorySource,
        dt,
        amount,
        merchant_name: cleanOptional(getMappedValue(row, columnMap.merchant_id)),
        notes: cleanOptional(getMappedValue(row, columnMap.notes)),
        tag_names: splitImportedValues(getMappedValue(row, columnMap.tag_ids)),
        counterparty_account_source: counterpartySource,
      })
    }
  }

  // A file whose every row has a problem is described by the list of problems, so the empty-file
  // message is kept for the case it was written for
  if (rows.length === 0 && rowProblems.length === 0) addError('No transaction rows are available to import.')
  if (errors.length > 0 || rowProblems.length > 0) return { errors, rowProblems, payload: null }
  return { errors: [], rowProblems: [], payload: { accounts, categories, rows } }
}

/**
 * Numbers a row as it appears in the file it came from, counting the header line where there is one
 */
function getImportRowLine(file: ImportFileDraft, rowIndex: number) {
  return file.hasHeaderRow ? rowIndex + 2 : rowIndex + 1
}

/**
 * Reports why one row cannot be converted, or null when it can
 *
 * The first failing check is what the row is listed under, since a row missing both its date and
 * its amount is one row to go and correct either way
 */
function getImportRowProblem({
  accountMappings,
  accountSource,
  amount,
  categorySource,
  counterpartySource,
  dt,
  recordsCounterpartyBySource,
}: {
  accountMappings: Record<string, string>
  accountSource: string
  amount: string
  categorySource: string
  counterpartySource: string | null
  dt: string
  recordsCounterpartyBySource: Record<string, boolean>
}) {
  if (!accountSource) return ROW_ACCOUNT_BLANK_REASON
  if (!categorySource) return ROW_CATEGORY_BLANK_REASON
  if (!dt) return ROW_DATE_UNREADABLE_REASON
  if (parseImportNumber(amount) === null) return ROW_AMOUNT_UNREADABLE_REASON
  if (!counterpartySource) return null

  if (!recordsCounterpartyBySource[categorySource]) return ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON
  if (isSameMappedAccount(accountMappings, accountSource, counterpartySource)) return ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON
  return null
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

function cleanOptional(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Reports whether the two sides of a transfer row end up in the same account, either through one
 * source being used on both sides or through two sources mapped onto one existing account, which is
 * how a renamed account is carried across
 *
 * Two different sources both set to create an account produce two separate accounts, so they match
 * only when the source itself is the same name
 */
function isSameMappedAccount(
  accountMappings: Record<string, string>,
  accountSource: string,
  counterpartySource: string,
) {
  if (accountSource === counterpartySource) return true

  const accountChoice = accountMappings[accountSource]
  if (!accountChoice || accountChoice === CREATE_ACCOUNT_VALUE) return false
  return accountChoice === accountMappings[counterpartySource]
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
