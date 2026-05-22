import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON } from '../constants'
import type { ImportCategoryKind, PreviewTransactionRow } from '../types'
import { isSupportedCurrency } from './valueParsers'

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

