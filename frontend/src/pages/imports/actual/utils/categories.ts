import type { Category } from '@/api/categories'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { getCategoryNameKey } from '@/pages/imports/utils/categoryMatching'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount } from '@/utils/transfers'
import { ACTUAL_MISCELLANEOUS_CATEGORY_NAME, ACTUAL_TRANSFER_CATEGORY_NAME } from '@/pages/imports/actual/constants'
import type { ActualCategorySource } from '@/pages/imports/actual/types'

/**
 * Says what kind of category a source is created as: transfer sources can only be transfers, since
 * their rows stay transfers between accounts, and a spending source follows Actual's income group
 */
export function getActualCategoryKind(source: ActualCategorySource): ImportCategoryKind {
  if (source.role === 'transfer') return 'transfer'
  return source.isIncome ? 'income' : 'expense'
}

/** Whether a category can carry the budget-side leg of a transfer, which has to record the other account */
export function canCarryActualTransfer(category: Pick<Category, 'kind' | 'name'>) {
  return doesTransferRecordCounterpartyAccount(category.kind, category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
}

/**
 * Fills in the category answers the user has not given
 *
 * Rows without a category go to Miscellaneous, as they do for Firefly III, and transfers whose other
 * side is gone go to Transfer. Every other source takes an existing category of the same name and
 * kind, capitals folded, and is created otherwise
 */
export function inferActualCategoryMappings(
  sources: ActualCategorySource[],
  explicitMappings: Record<string, string>,
  categories: Category[],
): Record<string, string> {
  const systemCategory = (name: string) => categories.find((category) => category.is_system && category.name === name)
  const miscellaneous = systemCategory(ACTUAL_MISCELLANEOUS_CATEGORY_NAME)
  const transfer = systemCategory(ACTUAL_TRANSFER_CATEGORY_NAME)

  const mappings: Record<string, string> = {}
  for (const source of sources) {
    if (explicitMappings[source.id]) {
      mappings[source.id] = explicitMappings[source.id]
      continue
    }

    if (source.role === 'uncategorized' || source.role === 'offBudgetUncategorized') {
      mappings[source.id] = miscellaneous?.id ?? CREATE_CATEGORY_VALUE
      continue
    }
    if (source.role === 'transfer' && !source.categoryId) {
      mappings[source.id] = transfer?.id ?? CREATE_CATEGORY_VALUE
      continue
    }

    const kind = getActualCategoryKind(source)
    const key = getCategoryNameKey(source.createName)
    const match = categories.find((category) => (
      getCategoryNameKey(category.name) === key
      && category.kind === kind
      && (source.role !== 'transfer' || canCarryActualTransfer(category))
    ))
    mappings[source.id] = match?.id ?? CREATE_CATEGORY_VALUE
  }
  return mappings
}

/**
 * Narrows the category choices for a transfer source to creating one and the categories that can
 * carry a transfer, so a loan payment can't be filed as spending that the transfer then cancels
 */
export function getActualTransferCategoryOptions(options: DropdownOption[], categoryById: Map<string, Category>) {
  return options.filter((option) => {
    if (option.value === CREATE_CATEGORY_VALUE) return true
    const category = categoryById.get(option.value)
    return category ? canCarryActualTransfer(category) : false
  })
}
