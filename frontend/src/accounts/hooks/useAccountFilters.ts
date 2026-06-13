import { useCallback, useMemo, useState } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { AccountFilterValues } from '@/accounts/types/accounts'
import {
  getAccountKindOptions,
  getAccountTypeOptions,
  getActiveAccountFilters,
  getFilteredAccounts,
  getInstitutionOptions,
} from '@/accounts/utils/accountFilters'

/**
 * Owns account filter state and derives the available filter options for the visible account list
 */
export function useAccountFilters(rows: AccountsOverview[]) {
  const [filters, setFilters] = useState<AccountFilterValues>({})

  const setFilter = useCallback((patch: Partial<AccountFilterValues>) => {
    setFilters((currentFilters) => {
      return getActiveAccountFilters({ ...currentFilters, ...patch })
    })
  }, [])

  const institutionOptions = useMemo(() => getInstitutionOptions(rows), [rows])
  const accountKindOptions = useMemo(() => getAccountKindOptions(rows), [rows])
  const accountTypeOptions = useMemo(() => getAccountTypeOptions(rows), [rows])

  const filteredRows = useMemo(
    () => getFilteredAccounts(rows, filters),
    [filters, rows],
  )

  return {
    filters,
    setFilter,
    institutionOptions,
    accountKindOptions,
    accountTypeOptions,
    filteredRows,
  }
}
