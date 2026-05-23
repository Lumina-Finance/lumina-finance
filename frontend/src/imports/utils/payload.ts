import type { AccountType } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { TransactionImportPayload, TransactionImportResponse } from '@/api/transactions'
import { ACCOUNT_TYPE_OPTIONS, COLUMN_TARGETS, CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON } from '../constants'
import type { ColumnMap, ColumnValidationErrors, ImportAccountSource, ImportBuildResult, ImportCategoryKind, ImportFileDraft } from '../types'
import { getCategoryMatchKind, splitImportedValues } from './categoryMatching'
import { getMappedValue } from './columnMapping'
import { getResolvedAccountChoice } from './accountMapping'
import { normalizeImportDate, parseImportNumber } from './valueParsers'

export function buildTransactionImportPayload({
  accountCreateCurrencies,
  accountCreateTypes,
  accountMappings,
  accountSources,
  categoryById,
  categoryCreateKinds,
  categoryMappings,
  categoryTypesBySource,
  columnMap,
  columnValidationErrors,
  files,
  importedCategories,
}: {
  accountCreateCurrencies: Record<string, string>
  accountCreateTypes: Record<string, string>
  accountMappings: Record<string, string>
  accountSources: ImportAccountSource[]
  categoryById: Map<string, Category>
  categoryCreateKinds: Record<string, ImportCategoryKind>
  categoryMappings: Record<string, string>
  categoryTypesBySource: Record<string, string>
  columnMap: ColumnMap
  columnValidationErrors: ColumnValidationErrors
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

  const mappedHeaders = new Set(Object.values(columnMap).filter(Boolean))
  for (const [header, message] of Object.entries(columnValidationErrors)) {
    if (mappedHeaders.has(header)) addError(message)
  }

  const accounts: TransactionImportPayload['accounts'] = []
  for (const source of accountSources) {
    const choice = getResolvedAccountChoice(accountMappings[source.id])
    appendAccountMapping(
      accounts,
      errors,
      source.id,
      source.label,
      choice,
      accountCreateTypes[source.id],
      accountCreateCurrencies[source.id],
    )
  }

  const categories: TransactionImportPayload['categories'] = []
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

    categories.push({ source, category_id: choice })
  }

  const rows: TransactionImportPayload['rows'] = []
  for (const file of files) {
    for (const row of file.rows) {
      const accountSource = columnMap.account_id ? getMappedValue(row, columnMap.account_id) : file.id
      const categorySource = getMappedValue(row, columnMap.category_id)
      const dt = normalizeImportDate(getMappedValue(row, columnMap.dt))
      const amount = getMappedValue(row, columnMap.amount)

      if (!accountSource) addError('Account source cannot be blank.')
      if (!categorySource) addError('Category source cannot be blank.')
      if (!dt) addError('Every imported row needs a valid date.')
      if (parseImportNumber(amount) === null) addError('Every imported row needs a valid raw amount.')

      rows.push({
        account_source: accountSource,
        category_source: categorySource,
        dt,
        amount,
        merchant_name: cleanOptional(getMappedValue(row, columnMap.merchant_id)),
        notes: cleanOptional(getMappedValue(row, columnMap.notes)),
        tag_names: splitImportedValues(getMappedValue(row, columnMap.tag_ids)),
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
  source: string,
  createName: string,
  choice: string,
  createType: string | undefined,
  createCurrency: string | undefined,
) {
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  if (!choice) {
    addError(`Map account: ${createName}`)
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
    },
  })
}

function isImportAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPE_OPTIONS.some((option) => option.value === value)
}

function cleanOptional(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

export function formatImportSummary(result: TransactionImportResponse) {
  const parts = [
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} imported`,
    `${result.accounts_created} account${result.accounts_created === 1 ? '' : 's'} created`,
    `${result.categories_created} categor${result.categories_created === 1 ? 'y' : 'ies'} created`,
  ]

  return parts.join(' · ')
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Import failed.'
}
