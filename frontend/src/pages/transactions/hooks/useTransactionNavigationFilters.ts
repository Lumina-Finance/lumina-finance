import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import { parseTransactionNavigationFilters, writeTransactionNavigationFilters } from '@/pages/transactions/utils/filterNavigation'

/**
 * Derives address-owned filters on every navigation while keeping all other filters local
 *
 * The first render and history changes read the address directly, without a synchronization effect
 */
export function useTransactionNavigationFilters() {
  const [params, setParams] = useSearchParams()
  const [localFilters, setLocalFilters] = useState<TransactionListFilters>({})
  const filters = useMemo(() => ({ ...localFilters, ...parseTransactionNavigationFilters(params) }), [localFilters, params])

  /** Commits a complete list filter state and adds its owned address fields to navigation history */
  function setFilters(next: TransactionListFilters) {
    const { category_id, from_date, to_date, ...local } = next
    setLocalFilters(local)
    const nextParams = writeTransactionNavigationFilters(params, { category_id, from_date, to_date })
    if (nextParams.toString() !== params.toString()) setParams(nextParams)
  }

  return { filters, setFilters }
}
