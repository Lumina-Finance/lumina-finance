import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { ImportAccountSource } from '@/pages/imports/types'
import { inferAccountMappingsWithCollisions } from '@/pages/imports/utils'

/**
 * Which existing accounts and categories an Actual import may use
 *
 * An import writes the user's own records. Every account in the file comes in as the user's own,
 * even one shared in Actual, and no group account or group category is offered, matched or taken.
 * Supporting grouped resources starts here
 */
export function isGroupResource(resource: { group_id?: string | null }) {
  return Boolean(resource.group_id)
}

/** The accounts an import may link to, out of the ones it may write rows to */
export function getPersonalAccounts(selectableAccounts: AccountsOverview[]) {
  return selectableAccounts.filter((account) => !isGroupResource(account))
}

/** Leaves group categories out of the category choices */
export function getPersonalCategoryOptions(options: DropdownOption[], categoryById: Map<string, Category>) {
  return options.filter((option) => {
    const category = categoryById.get(option.value)
    return !category || !isGroupResource(category)
  })
}

/**
 * Fills in the account answers the user has not given. A name matches an existing account of the
 * user's own where only one fits. Once the account list is current, the rest default to
 * create-new, apart from names sharing one match, which need an explicit answer
 */
export function resolveActualAccountMappings(
  sources: ImportAccountSource[],
  explicitMappings: Record<string, string>,
  selectableAccounts: AccountsOverview[],
  accountsCurrent: boolean,
) {
  const personalAccounts = getPersonalAccounts(selectableAccounts)
  const inferred = inferAccountMappingsWithCollisions(sources, explicitMappings, {
    rowAccounts: personalAccounts,
    counterpartyAccounts: personalAccounts,
  })
  if (!accountsCurrent) return inferred.mappings
  for (const source of sources) {
    if (!inferred.mappings[source.id] && !inferred.collidingSourceIds.has(source.id)) {
      inferred.mappings[source.id] = CREATE_ACCOUNT_VALUE
    }
  }
  return inferred.mappings
}
