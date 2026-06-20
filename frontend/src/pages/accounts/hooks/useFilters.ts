import { useCallback, useMemo, useState } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import type { FilterValues } from '@/pages/accounts/types/accounts'
import {
  getActiveFilters,
  getFilteredRows,
  getInstitutionOptions,
  getKindOptions,
  getTypeOptions,
} from '@/pages/accounts/utils/filters'

/**
 * Owns account filter state, the account search text, and the derived option lists for the visible
 * account list. Filters and search are kept apart so the search field stays separate from the filter
 * pill, mirroring the transactions toolbar
 */
export function useFilters(rows: AccountsOverview[]) {
  const [filters, setFilters] = useState<FilterValues>({})
  const [search, setSearch] = useState('')

  const setFilter = useCallback((patch: Partial<FilterValues>) => {
    setFilters((currentFilters) => {
      return getActiveFilters({ ...currentFilters, ...patch })
    })
  }, [])

  const institutionOptions = useMemo(() => getInstitutionOptions(rows), [rows])
  const kindOptions = useMemo(() => getKindOptions(rows), [rows])
  const typeOptions = useMemo(() => getTypeOptions(rows), [rows])

  const filteredRows = useMemo(
    () => getFilteredRows(rows, filters, search),
    [filters, rows, search],
  )

  // Counts the facets carrying a selection so the filter pill can show a badge, leaving the search
  // text out since it has its own field
  const activeFilterCount = Object.values(filters).filter((values) => values?.length).length

  return {
    filters,
    setFilter,
    search,
    setSearch,
    activeFilterCount,
    institutionOptions,
    kindOptions,
    typeOptions,
    filteredRows,
  }
}
