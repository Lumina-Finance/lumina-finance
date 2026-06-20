import type { AccountKind, AccountType, AccountsOverview } from '@/api/accounts'
import type { OptionItem } from '@/components/filters/OptionList'
import type { FilterValues } from '@/pages/accounts/types/accounts'

const KIND_OPTIONS: OptionItem[] = [
  { value: 'asset', label: 'Assets' },
  { value: 'revolving', label: 'Revolving credit' },
  { value: 'amortizing', label: 'Amortizing debt' },
]

// Group labels mirror the account sections so filter options follow the page structure
const TYPE_OPTIONS: OptionItem[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing debt' },
]

/**
 * Drops empty facet selections so downstream comparisons and the active-filter count only handle
 * facets that actually narrow the list
 */
export function getActiveFilters(filters: FilterValues) {
  const activeFilters = { ...filters }
  for (const key of Object.keys(activeFilters) as (keyof FilterValues)[]) {
    if (!activeFilters[key]?.length) delete activeFilters[key]
  }
  return activeFilters
}

/**
 * Builds sorted institution filter options from accounts with linked institutions
 */
export function getInstitutionOptions(rows: AccountsOverview[]): OptionItem[] {
  const seen = new Map<string, string>()
  for (const account of rows) {
    if (account.institution) seen.set(account.institution.id, account.institution.name)
  }
  return Array.from(seen, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Keeps account kind filter options limited to kinds that exist in the current account list
 */
export function getKindOptions(rows: AccountsOverview[]): OptionItem[] {
  const present = new Set(rows.map((account) => account.account_kind))
  return KIND_OPTIONS.filter((option) => present.has(option.value as AccountKind))
}

/**
 * Keeps account type filter options limited to types that exist in the current account list
 */
export function getTypeOptions(rows: AccountsOverview[]): OptionItem[] {
  const present = new Set(rows.map((account) => account.account_type))
  return TYPE_OPTIONS.filter((option) => present.has(option.value as AccountType))
}

/**
 * Matches an account against the search text by its name and linked institution, so a query narrows
 * the list the same way whether the user types the account or its bank
 */
function isAccountMatchingSearch(account: AccountsOverview, query: string): boolean {
  if (account.name.toLowerCase().includes(query)) return true
  return account.institution?.name.toLowerCase().includes(query) ?? false
}

/**
 * Applies the active facet selections and the search text, keeping an account only when it matches at
 * least one selected value in every active facet. Accounts with no linked institution stay hidden
 * once an institution facet is active, since they cannot match any selected institution
 */
export function getFilteredRows(
  rows: AccountsOverview[],
  filters: FilterValues,
  search: string,
) {
  const query = search.trim().toLowerCase()
  return rows.filter((account) => {
    if (filters.institution_id && !(account.institution && filters.institution_id.includes(account.institution.id))) return false
    if (filters.account_kind && !filters.account_kind.includes(account.account_kind)) return false
    if (filters.account_type && !filters.account_type.includes(account.account_type)) return false
    if (query && !isAccountMatchingSearch(account, query)) return false
    return true
  })
}
