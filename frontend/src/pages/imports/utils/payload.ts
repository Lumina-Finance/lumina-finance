import type { Category } from '@/api/categories'
import type { TransactionImportPayload, TransactionImportResponse } from '@/api/transaction-imports'
import { COLUMN_TARGETS, CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON, OUTSIDE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME } from '@/pages/transactions/components/transaction-modal/constants'
import { doesTransferRecordOtherAccount } from '@/pages/transactions/components/transaction-modal/utils/validation'
import type { ColumnMap, ColumnValidationErrors, ImportAccountSource, ImportBuildResult, ImportCategoryKind, ImportFileDraft } from '@/pages/imports/types'
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
    )
  }

  const categories: TransactionImportPayload['categories'] = []

  // Only a transfer category records where the money went, so the rule is settled per category
  // source once and read back for every row using it
  const recordsOtherAccountBySource: Record<string, boolean> = {}
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

      // A category created by the import is never the system Balance Adjustment
      recordsOtherAccountBySource[source] = doesTransferRecordOtherAccount(kind, false)
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

    const category = categoryById.get(choice)
    recordsOtherAccountBySource[source] = category
      ? doesTransferRecordOtherAccount(
        category.kind,
        Boolean(category.is_system && category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME),
      )
      : false
    categories.push({ source, category_id: choice })
  }

  const rows: TransactionImportPayload['rows'] = []
  for (const file of files) {
    for (const row of file.rows) {
      const accountSource = columnMap.account_id ? getMappedValue(row, columnMap.account_id) : file.id
      const categorySource = getMappedValue(row, columnMap.category_id)
      const dt = dateFormat ? readImportDate(getMappedValue(row, columnMap.dt), dateFormat) : ''
      const amount = getMappedValue(row, columnMap.amount)

      const otherAccountSource = columnMap.other_account_id
        ? cleanOptional(getMappedValue(row, columnMap.other_account_id))
        : null

      if (!accountSource) addError('Account source cannot be blank.')
      if (!categorySource) addError('Category source cannot be blank.')
      if (!dt) addError('Every imported row needs a valid date.')
      if (parseImportNumber(amount) === null) addError('Every imported row needs a valid raw amount.')

      if (otherAccountSource) {
        if (!recordsOtherAccountBySource[categorySource]) {
          addError(`Only a transfer records the other account: ${otherAccountSource}`)
        } else if (isSameMappedAccount(accountMappings, accountSource, otherAccountSource)) {
          addError(`A transfer cannot record its own account as the other side: ${otherAccountSource}`)
        }
      }

      rows.push({
        account_source: accountSource,
        category_source: categorySource,
        dt,
        amount,
        merchant_name: cleanOptional(getMappedValue(row, columnMap.merchant_id)),
        notes: cleanOptional(getMappedValue(row, columnMap.notes)),
        tag_names: splitImportedValues(getMappedValue(row, columnMap.tag_ids)),
        other_account_source: otherAccountSource,
      })
    }
  }

  if (rows.length === 0) addError('No transaction rows are available to import.')
  if (errors.length > 0) return { errors, payload: null }
  return { errors: [], payload: { accounts, categories, rows } }
}

function appendAccountMapping(
  accounts: TransactionImportPayload['accounts'],
  errors: string[],
  accountSource: ImportAccountSource,
  choice: string,
  createType: string | undefined,
  createCurrency: string | undefined,
  createInstitution: string | undefined,
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
    // Reachable when the answer was chosen and the other-account column was then unmapped, which
    // turns the source into one that rows are written to
    if (!accountSource.isOtherSideOnly) {
      addError(`Rows are imported into this account, so it cannot be outside this app: ${createName}`)
      return
    }

    accounts.push({ source, outside: true })
    return
  }

  if (choice !== CREATE_ACCOUNT_VALUE) {
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
 * Reports whether two account sources were mapped onto the same existing account, which is how a
 * renamed account is carried across and would leave a transfer recording the account it sits in
 *
 * Two sources both set to create a new account produce two separate accounts, so they never match
 */
function isSameMappedAccount(
  accountMappings: Record<string, string>,
  accountSource: string,
  otherAccountSource: string,
) {
  const accountChoice = accountMappings[accountSource]
  if (!accountChoice || accountChoice === CREATE_ACCOUNT_VALUE) return false
  return accountChoice === accountMappings[otherAccountSource]
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
