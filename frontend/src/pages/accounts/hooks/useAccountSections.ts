import { useMemo } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import { getAccountSections } from '@/pages/accounts/utils/accountSections'

/**
 * Memoizes the net worth statement figures for the accounts page
 */
export function useAccountSections(rows: AccountsOverview[]) {
  return useMemo(() => getAccountSections(rows), [rows])
}
