import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useAccounts, type AccountsOverview } from '@/api/accounts'
import { IMPORT_ACCOUNT_PARAM } from '@/pages/imports/constants'
import { getImportAccountScopeState, type ImportAccountScopeState } from '@/pages/imports/utils'

/**
 * The account an import was started from, and what the page should do about it
 */
export interface ImportAccountScope {
  /** The account the address points at, null on an ordinary import started from Settings */
  accountId: string | null

  /** The account itself, only once it is settled that an import may be written to it */
  account: AccountsOverview | null

  state: ImportAccountScopeState
  refetchAccounts: () => void
}

/**
 * Reads the account an import was started from and settles whether the page may import into it
 *
 * The same accounts query both import flows already read, so this costs no extra request, and the
 * three flags it derives are the ones `useImportReferenceData` derives from the same query
 */
export function useImportAccountScope(): ImportAccountScope {
  const [searchParams] = useSearchParams()
  const accountId = searchParams.get(IMPORT_ACCOUNT_PARAM)
  const {
    data: accounts = [],
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useAccounts()

  const account = useMemo(
    () => (accountId ? accounts.find((candidate) => candidate.id === accountId) : undefined),
    [accountId, accounts],
  )

  const state = getImportAccountScopeState({
    accountId,
    account,
    accountsCurrent: dataUpdatedAt > 0 && !isFetching && !isError,
    accountsError: isError,
  })

  return {
    accountId,
    // Held back until the state settles, so nothing downstream can file rows into an account that
    // is archived, closed or still being judged
    account: state === 'ready' && account ? account : null,
    state,
    refetchAccounts: refetch,
  }
}
