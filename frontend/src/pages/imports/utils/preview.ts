import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON } from '@/pages/imports/constants'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type { ColumnMap, ImportCategoryKind, ImportFileDraft, ImportRowProblem, PreviewTransactionRow } from '@/pages/imports/types'
import { getImportAccountName } from './accountMapping'
import { getImportRowId } from './common'
import { splitImportedValues } from './categoryMatching'
import { getMappedValue } from './columnMapping'
import { findCurrencyExponent } from '@/utils/moneyInput'
import { getSupportedCurrencyCodes } from './workflowOptions'
import {
  type ImportDateFormat,
  getPreviewDateLabel,
  isSupportedCurrency,
  parseImportNumber,
  readImportDate,
  toImportMinorUnits,
} from './valueParsers'

interface BuildImportPreviewRowsOptions {
  files: ImportFileDraft[]
  columnMap: ColumnMap
  dateFormat: ImportDateFormat | null
  missingRequiredColumnLabels: string[]
  currencies: Currency[]
  accountById: Map<string, AccountsOverview>
  accountCreateCurrencies: Record<string, string>
  accountCreateInstitutions: Record<string, string>
  categoryById: Map<string, Category>
  categoryCreateKinds: Record<string, ImportCategoryKind>
  categoryTypesBySource: Record<string, string>
  institutionById: Map<string, Institution>
  resolvedAccountMappings: Record<string, string>
  resolvedCategoryMappings: Record<string, string>
  rowProblems: ImportRowProblem[]
}

/**
 * Groups consecutive preview rows that share the same date label, for rendering the preview list
 * under one heading per day
 */
export function groupPreviewRowsByDate(rows: PreviewTransactionRow[]) {
  const groups: Array<{ dateLabel: string; rows: PreviewTransactionRow[] }> = []

  for (const row of rows) {
    let group = groups[groups.length - 1]
    if (!group || group.dateLabel !== row.dateLabel) {
      group = { dateLabel: row.dateLabel, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }

  return groups
}

/**
 * Builds the first preview rows from mapped CSV files so the import review can show representative transactions
 */
export function buildImportPreviewRows({
  files,
  columnMap,
  dateFormat,
  missingRequiredColumnLabels,
  currencies,
  accountById,
  accountCreateCurrencies,
  accountCreateInstitutions,
  categoryById,
  categoryCreateKinds,
  categoryTypesBySource,
  institutionById,
  resolvedAccountMappings,
  resolvedCategoryMappings,
  rowProblems,
}: BuildImportPreviewRowsOptions): PreviewTransactionRow[] {
  if (missingRequiredColumnLabels.length > 0) return []

  // A row that cannot be converted is listed with its reason instead, so previewing it as well
  // would show an amount of zero or a blank date beside the entry saying why it was refused
  const problemRowIds = new Set(rowProblems.map((problem) => problem.id))
  const rows: PreviewTransactionRow[] = []
  const fallbackCurrency = currencies.some((currency) => currency.id === 'CAD') ? 'CAD' : currencies[0]?.id ?? 'CAD'
  const supportedCurrencyCodes = getSupportedCurrencyCodes(currencies)
  const timestamp = new Date().toISOString()

  // Preview generation walks files in row order and stops early because the UI only renders a small sample
  for (const file of files) {
    for (let rowIndex = 0; rowIndex < file.rows.length; rowIndex += 1) {
      if (problemRowIds.has(getImportRowId(file.id, rowIndex))) continue

      const row = file.rows[rowIndex]
      const accountSource = columnMap.account_id ? getMappedValue(row, columnMap.account_id) : file.id
      const accountLabel = columnMap.account_id ? accountSource : getImportAccountName(file.name)
      const accountChoice = resolvedAccountMappings[accountSource] ?? ''
      const account = accountChoice === CREATE_ACCOUNT_VALUE ? undefined : accountById.get(accountChoice)
      const createAccountCurrency = accountChoice === CREATE_ACCOUNT_VALUE
        ? accountCreateCurrencies[accountSource] ?? ''
        : ''
      const createAccountInstitution = accountChoice === CREATE_ACCOUNT_VALUE
        ? institutionById.get(accountCreateInstitutions[accountSource] ?? '')
        : undefined
      const importedDate = getMappedValue(row, columnMap.dt)
      const dt = dateFormat ? readImportDate(importedDate, dateFormat) : ''
      const merchant = getMappedValue(row, columnMap.merchant_id)
      const notes = getMappedValue(row, columnMap.notes)
      const currency = getPreviewCurrency(
        account?.currency,
        createAccountCurrency,
        fallbackCurrency,
        supportedCurrencyCodes,
      )
      const rawAmount = getMappedValue(row, columnMap.amount)
      const amountValue = parseImportNumber(rawAmount) ?? 0
      const exponent = findCurrencyExponent(currencies, currency)
      const minorUnits = exponent === null ? 'unreadable' : toImportMinorUnits(rawAmount, exponent)

      // A row whose amount this currency cannot hold is one the commit will refuse, so it is left
      // out rather than previewed with a rounded number. It is usually already excluded as a
      // problem row, and reaches here either where an unanswered mapping question stopped the
      // payload build before it judged any row, or where the currency is missing from the loaded
      // table and there are no decimal places to convert against
      if (typeof minorUnits !== 'bigint') continue

      // Past the range a number holds exactly this loses digits, which is a display artifact on an
      // amount around ninety trillion in a two-decimal currency. The commit sends the cell's text
      const amount = Number(minorUnits)
      const importedCategory = getMappedValue(row, columnMap.category_id)
      const importedTagValues = splitImportedValues(getMappedValue(row, columnMap.tag_ids))
      const category = getPreviewCategory(
        importedCategory,
        resolvedCategoryMappings,
        categoryById,
        categoryCreateKinds,
        categoryTypesBySource,
        amountValue,
      )
      const tagIds = importedTagValues.map((tag, tagIndex) => `${file.id}-${rowIndex}-tag-${tagIndex}-${tag}`)

      // A row states its counterparty only where the file has a column for it and the row's category
      // can hold one, and the answer is whatever that source was mapped to, which can be an account
      // or money leaving the app
      const recordsCounterparty = doesPreviewCategoryRecordCounterparty(category)
      const counterpartySource = recordsCounterparty && columnMap.counterparty_account_id
        ? getMappedValue(row, columnMap.counterparty_account_id).trim()
        : ''
      const counterpartyChoice = counterpartySource ? resolvedAccountMappings[counterpartySource] ?? '' : ''
      const counterpartyAccount = counterpartyChoice === CREATE_ACCOUNT_VALUE || counterpartyChoice === OUTSIDE_ACCOUNT_VALUE
        ? undefined
        : accountById.get(counterpartyChoice)

      // An account queued for creation has no id or row of its own yet, so it stands in with the
      // same sentinel the row's own account uses and shows under the source it came from
      const counterpartyName = counterpartyChoice === CREATE_ACCOUNT_VALUE
        ? counterpartySource
        : counterpartyAccount?.name

      rows.push({
        id: getImportRowId(file.id, rowIndex),
        accountInstitution: account?.institution ?? createAccountInstitution ?? null,
        accountName: account?.name ?? (accountLabel || 'Unmapped account'),
        category,
        currency,
        dateLabel: getPreviewDateLabel(dt),
        counterpartyAccountName: counterpartyName,
        transaction: {
          id: `import-preview-${file.id}-${rowIndex}`,
          created_by_user_id: 'import-preview',
          account_id: account?.id ?? accountChoice,
          dt,
          merchant_id: merchant ? `import-preview-merchant-${file.id}-${rowIndex}` : null,
          merchant_name: merchant || null,
          category_id: category?.id ?? '',
          amount,
          account_amount: amount,
          base_currency_amount: amount,
          currency,
          fx_rate: null,
          notes: notes || null,

          counterparty_account_id: counterpartyAccount?.id ?? (counterpartyChoice === CREATE_ACCOUNT_VALUE ? CREATE_ACCOUNT_VALUE : null),
          counterparty_account_scope: getPreviewCounterpartyScope(recordsCounterparty, counterpartyChoice),
          created_at: timestamp,
          updated_at: timestamp,
          tag_ids: tagIds,
          tags: importedTagValues.map((tag, tagIndex) => ({
            id: tagIds[tagIndex],
            group_id: null,
            name: tag,
          })),
        },
      })

      if (rows.length >= 5) return rows
    }
  }

  return rows
}

/**
 * Reports whether a previewed row's category can record where the money went
 *
 * The backend matches Balance Adjustment by name alone, so this does too, and a row the API would
 * refuse a counterparty account for is previewed without one
 */
function doesPreviewCategoryRecordCounterparty(category: Category | undefined) {
  if (!category) return false
  return doesTransferRecordCounterpartyAccount(category.kind, category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
}

/**
 * Resolves what a previewed transfer will record about where the money went
 *
 * A transfer that states no counterparty records that the money left the app, which is what the
 * import writes for it, and a category that records neither leaves both fields empty
 */
function getPreviewCounterpartyScope(recordsCounterparty: boolean, counterpartyChoice: string) {
  if (!recordsCounterparty) return null
  return counterpartyChoice && counterpartyChoice !== OUTSIDE_ACCOUNT_VALUE ? 'tracked' : 'outside'
}

/**
 * Picks the currency a previewed transaction will use, preferring the mapped account's currency
 * over the currency chosen for a new account and then the caller's fallback, and falling back to
 * CAD when none of those is a supported currency
 *
 * The row's own currency column is deliberately not consulted. A row is stored in its account's
 * currency, so previewing it in the imported one would show an amount scaled by decimal places
 * the import will not use
 */
export function getPreviewCurrency(
  accountCurrency: string | undefined,
  createAccountCurrency: string,
  fallbackCurrency: string,
  supportedCurrencyCodes: Set<string>,
) {
  for (const currency of [accountCurrency, createAccountCurrency, fallbackCurrency]) {
    const normalized = currency?.trim().toUpperCase()
    if (normalized && isSupportedCurrency(normalized, supportedCurrencyCodes)) return normalized
  }

  return 'CAD'
}

/**
 * Resolves the category a previewed transaction will use, building a placeholder record for a
 * category queued to be created and looking up an existing one otherwise
 */
export function getPreviewCategory(
  importedCategory: string,
  categoryMappings: Record<string, string>,
  categoryById: Map<string, Category>,
  categoryCreateKinds: Record<string, ImportCategoryKind>,
  categoryTypesBySource: Record<string, string>,
  amount: number,
) {
  if (!importedCategory) return undefined

  const mapped = categoryMappings[importedCategory]
  if (mapped === CREATE_CATEGORY_VALUE) {
    return {
      id: `import-preview-category-${importedCategory}`,
      group_id: null,
      owner_id: null,
      name: importedCategory,
      kind: getPreviewCategoryKind(categoryCreateKinds[importedCategory], categoryTypesBySource[importedCategory], amount),
      icon: DEFAULT_CATEGORY_ICON,
      is_system: false,
      created_at: '',
    }
  }

  if (mapped) return categoryById.get(mapped)
  return undefined
}

/**
 * Determines the kind a previewed category will be created with, preferring an explicit choice over
 * a kind implied by the imported data, and falling back to the transaction amount's sign
 */
export function getPreviewCategoryKind(
  categoryKind: ImportCategoryKind | undefined,
  categoryType: string | undefined,
  amount: number,
): Category['kind'] {
  if (categoryKind) return categoryKind
  if (categoryType === 'Transfer') return 'transfer'
  if (categoryType === 'Income') return 'income'
  if (categoryType === 'Expense') return 'expense'
  if (amount > 0) return 'income'
  return 'expense'
}
