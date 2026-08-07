import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAccounts } from '@/api/accounts'
import type { AccountsOverview } from '@/api/accounts'
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
 *
 * The answer is settled once per account and then held. The question this asks is whether an import
 * may be started here, and an account archived elsewhere while one is already under way must not
 * take the running import off the screen, nor quietly turn the staged file back into an ordinary
 * import whose rows rest on creating an account. The commit refuses to write rows to an archived
 * account anyway, which is where a change made elsewhere belongs. Pointing the address at a
 * different account asks again
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

  const accountsCurrent = dataUpdatedAt > 0 && !isFetching && !isError

  const liveState = getImportAccountScopeState({
    accountId,
    account,
    accountsCurrent,
    accountsError: isError,
  })

  // Settled only on an answer a current list gave. `ready` is deliberately optimistic about a list
  // that may be months old, which is right while the fresh one is still on its way and wrong to
  // hold for the rest of the page: an account archived before this page was ever opened would then
  // never be corrected, and the import would run to a commit that refuses every row
  //
  // The account carries on being read from the list while it is settled, so a rename shows, and it
  // is only replaced wholesale when the address points somewhere else
  const [settledAccount, setSettledAccount] = useState<AccountsOverview | null>(null)
  const isSettled = Boolean(accountId) && settledAccount?.id === accountId
  if (liveState === 'ready' && accountsCurrent && account && settledAccount !== account) {
    setSettledAccount(account)
  }

  const state = isSettled ? 'ready' : liveState

  return {
    accountId,
    // Held back until the state settles, so nothing downstream can file rows into an account that
    // is archived, closed or still being judged
    account: state === 'ready' ? settledAccount ?? account ?? null : null,
    state,
    refetchAccounts: refetch,
  }
}
