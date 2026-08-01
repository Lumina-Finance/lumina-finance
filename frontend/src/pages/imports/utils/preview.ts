import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON } from '@/pages/imports/constants'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, OUTSIDE_ACCOUNT_VALUE } from '@/pages/transactions/components/transaction-modal/constants'
import { doesTransferRecordOtherAccount } from '@/pages/transactions/components/transaction-modal/utils/validation'
import type { ColumnMap, ImportCategoryKind, ImportFileDraft, PreviewTransactionRow } from '@/pages/imports/types'
import { getImportAccountName } from './accountMapping'
import { splitImportedValues } from './categoryMatching'
import { getMappedValue } from './columnMapping'
import {
  type ImportDateFormat,
  getPreviewDateLabel,
  isSupportedCurrency,
  parseImportNumber,
  readImportDate,
  toMinorUnits,
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
}: BuildImportPreviewRowsOptions): PreviewTransactionRow[] {
  if (missingRequiredColumnLabels.length > 0) return []

  const rows: PreviewTransactionRow[] = []
  const fallbackCurrency = currencies.some((currency) => currency.id === 'CAD') ? 'CAD' : currencies[0]?.id ?? 'CAD'
  const timestamp = new Date().toISOString()

  // Preview generation walks files in row order and stops early because the UI only renders a small sample
  for (const file of files) {
    for (let rowIndex = 0; rowIndex < file.rows.length; rowIndex += 1) {
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
        getMappedValue(row, columnMap.currency),
        account?.currency,
        createAccountCurrency,
        fallbackCurrency,
      )
      const amountValue = parseImportNumber(getMappedValue(row, columnMap.amount)) ?? 0
      const amount = toMinorUnits(amountValue, currency)
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

      // A row states the other side only where the file has a column for it and the row's category
      // can hold one, and the answer is whatever that source was mapped to, which can be an account
      // or money leaving the app
      const otherAccountSource = columnMap.other_account_id && doesPreviewCategoryRecordOtherAccount(category)
        ? getMappedValue(row, columnMap.other_account_id).trim()
        : ''
      const otherAccountChoice = otherAccountSource ? resolvedAccountMappings[otherAccountSource] ?? '' : ''
      const otherAccount = otherAccountChoice === CREATE_ACCOUNT_VALUE || otherAccountChoice === OUTSIDE_ACCOUNT_VALUE
        ? undefined
        : accountById.get(otherAccountChoice)

      rows.push({
        id: `${file.id}-${rowIndex}`,
        accountInstitution: account?.institution ?? createAccountInstitution ?? null,
        accountName: account?.name ?? (accountLabel || 'Unmapped account'),
        category,
        currency,
        dateLabel: getPreviewDateLabel(dt),
        otherAccountName: otherAccount?.name,
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

          other_account_id: otherAccount?.id ?? null,
          other_account_scope: getPreviewOtherAccountScope(otherAccountChoice, otherAccount?.id),
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
 * refuse an other account for is previewed without one
 */
function doesPreviewCategoryRecordOtherAccount(category: Category | undefined) {
  if (!category) return false
  return doesTransferRecordOtherAccount(category.kind, category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
}

/**
 * Resolves what a previewed transfer will record about where the money went
 *
 * An account queued to be created has no id until the import runs, so the preview shows that row
 * as unanswered rather than pointing at an account that does not exist yet
 */
function getPreviewOtherAccountScope(otherAccountChoice: string, otherAccountId: string | undefined) {
  if (otherAccountChoice === OUTSIDE_ACCOUNT_VALUE) return 'outside'
  return otherAccountId ? 'tracked' : null
}

/**
 * Picks the currency a previewed transaction will use, preferring the imported value over the
 * mapped account's currency, the currency chosen for a new account, and finally the caller's
 * fallback, and falling back to CAD when none of those is a supported currency
 */
export function getPreviewCurrency(
  importedCurrency: string,
  accountCurrency: string | undefined,
  createAccountCurrency: string,
  fallbackCurrency: string,
) {
  for (const currency of [importedCurrency, accountCurrency, createAccountCurrency, fallbackCurrency]) {
    const normalized = currency?.trim().toUpperCase()
    if (normalized && isSupportedCurrency(normalized)) return normalized
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
