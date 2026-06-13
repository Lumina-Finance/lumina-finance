import { useMemo } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import { getAccountSections } from '@/pages/accounts/utils/accountSections'

/**
 * Memoizes account section totals and filtered section rows for the accounts page
 */
export function useAccountSections({
  rows,
  filteredRows,
}: {
  rows: AccountsOverview[]
  filteredRows: AccountsOverview[]
}) {
  return useMemo(
    () => getAccountSections({ rows, filteredRows }),
    [filteredRows, rows],
  )
}
