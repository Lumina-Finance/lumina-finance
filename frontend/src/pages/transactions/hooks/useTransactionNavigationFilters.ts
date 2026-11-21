import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { TransactionListFilters } from '@/components/transactions/types/transactionList'
import {
  parseTransactionNavigationFilters,
  setAsideRefusedDates,
  writeTransactionNavigationFilters,
} from '@/components/transactions/utils/filterNavigation'

/**
 * Derives address-owned filters on every navigation while keeping all other filters local
 *
 * The first render and history changes read the address directly, without a synchronization effect. A
 * date the filter panel would refuse is returned apart from the filters, for the panel to show
 *
 * @param todayYmd - Today in the user's timezone as "YYYY-MM-DD", the day the window is measured from
 */
export function useTransactionNavigationFilters(todayYmd: string) {
  const [params, setParams] = useSearchParams()
  const [localFilters, setLocalFilters] = useState<TransactionListFilters>({})
  const { applied, refused } = useMemo(
    () => setAsideRefusedDates(parseTransactionNavigationFilters(params), todayYmd),
    [params, todayYmd],
  )
  const filters = useMemo(() => ({ ...localFilters, ...applied }), [localFilters, applied])

  /** Commits a complete list filter state and adds its owned address fields to navigation history */
  function setFilters(next: TransactionListFilters) {
    const { category_id, from_date, to_date, ...local } = next
    setLocalFilters(local)
    const nextParams = writeTransactionNavigationFilters(params, { category_id, from_date, to_date })
    if (nextParams.toString() !== params.toString()) setParams(nextParams)
  }

  return { filters, setFilters, refusedDates: refused }
}
