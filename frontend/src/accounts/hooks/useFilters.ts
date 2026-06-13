import { useCallback, useMemo, useState } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { FilterValues } from '@/accounts/types/accounts'
import {
  getActiveFilters,
  getFilteredRows,
  getInstitutionOptions,
  getKindOptions,
  getTypeOptions,
} from '@/accounts/utils/filters'

/**
 * Owns account filter state and derives the available filter options for the visible account list
 */
export function useFilters(rows: AccountsOverview[]) {
  const [filters, setFilters] = useState<FilterValues>({})

  const setFilter = useCallback((patch: Partial<FilterValues>) => {
    setFilters((currentFilters) => {
      return getActiveFilters({ ...currentFilters, ...patch })
    })
  }, [])

  const institutionOptions = useMemo(() => getInstitutionOptions(rows), [rows])
  const kindOptions = useMemo(() => getKindOptions(rows), [rows])
  const typeOptions = useMemo(() => getTypeOptions(rows), [rows])

  const filteredRows = useMemo(
    () => getFilteredRows(rows, filters),
    [filters, rows],
  )

  return {
    filters,
    setFilter,
    institutionOptions,
    kindOptions,
    typeOptions,
    filteredRows,
  }
}
