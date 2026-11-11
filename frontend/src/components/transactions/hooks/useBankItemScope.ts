import { useCallback, useMemo } from 'react'
import { useAccounts } from '@/api/accounts'
import { offersBankSync, useBankLinks, useBankProviders } from '@/api/bank-sync'
import { useAuth } from '@/hooks/useAuth'
import type { ReviewItemAccount } from '@/components/transactions/bank-review/ReviewBlock'
import { getReviewAccountIds } from '@/components/transactions/utils/bankReview'

/**
 * Which accounts' bank items to read for a transaction list, and the name and currency each item's
 * row shows for its account
 *
 * Nothing is in scope until the accounts and either the bank links or the providers have loaded, since
 * only the user's own personal accounts have bank items, kept after an unlink, and each item's amount is
 * written in its account's currency. An item whose account
 * isn't loaded can't be shown, so asking for it throws
 *
 * @param listAccountIds - The accounts the list is filtered or fixed to, empty or absent for every account
 */
export function useBankItemScope(listAccountIds: string[] | undefined) {
  const { user } = useAuth()
  const { data: accounts } = useAccounts()
  const { data: links } = useBankLinks()
  const { data: providers } = useBankProviders()

  // An unlinked account keeps its waiting items, so a user reads them while the deployment lets them
  // link or they have a live link, and nothing is read until one of those has loaded
  const readsItems = (links?.length ?? 0) > 0 || offersBankSync(providers)

  // Undefined reads every account's items, and an empty list reads none
  const accountIds = accounts && user ? getReviewAccountIds(accounts, user.id, listAccountIds, readsItems) : []
  const accountById = useMemo(() => new Map((accounts ?? []).map((account) => [account.id, account])), [accounts])
  const accountFor = useCallback(
    (accountId: string): ReviewItemAccount => {
      const account = accountById.get(accountId)
      if (!account) throw new Error(`Account ${accountId} is not loaded, so its bank items cannot be shown`)
      return { name: account.name, currency: account.currency }
    },
    [accountById],
  )

  return {
    accounts,
    accountIds,
    isInScope: accountIds === undefined || accountIds.length > 0,
    accountById,
    accountFor,
  }
}
