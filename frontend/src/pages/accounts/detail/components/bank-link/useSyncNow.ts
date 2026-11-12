import { useEffect, useReducer } from 'react'
import { useSyncBankAccount, type BankConnection, type BankLink, type BankProvidersResponse } from '@/api/bank-sync'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { useRelativeTimeRefresh } from '@/hooks/useRelativeTimeRefresh'
import { useToast } from '@/hooks/useToast'
import {
  describeSyncNow,
  describeSyncNowBlock,
  SYNC_FAILED_MESSAGE,
} from '@/pages/accounts/detail/components/bank-link/syncNow'
import { getSaveFailureMessage } from '@/utils/createFailure'
import { callWhenPassed } from '@/utils/timing'

/**
 * Sync now for a live link, shared by every control that offers it: what it shows, why it is held
 * back, and the press. A spent request budget lets it go once a request frees up, whether or not the
 * connection has been read again since, and its reason is worded again each minute until then, so when
 * more requests are available stays current. A press the server refuses says why in a toast
 */
export function useSyncNow(
  link: BankLink,
  connection: BankConnection | undefined,
  providers: BankProvidersResponse | undefined,
) {
  const sync = useSyncBankAccount()
  const feedback = useActionFeedback()
  const { showToast } = useToast()

  const [, renderAgain] = useReducer((count: number) => count + 1, 0)
  const budgetFreesAt = connection?.request_budget.available_again_at ?? null
  useEffect(() => callWhenPassed(budgetFreesAt, renderAgain), [budgetFreesAt])
  useRelativeTimeRefresh(() => describeSyncNowBlock(link, connection, providers) ?? '')

  const { status, block } = describeSyncNow(feedback.status, link, connection, providers)
  const syncNow = () => {
    void feedback
      .run(() => sync.mutateAsync(link.account_id))
      .catch((cause: unknown) => {
        showToast({ status: 'error', text: getSaveFailureMessage(cause, SYNC_FAILED_MESSAGE) })
      })
  }

  return { status, block, busy: status !== 'idle', syncNow }
}
