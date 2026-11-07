import { useEffect, useReducer } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useSyncBankAccount, type BankConnection, type BankLink, type BankProvidersResponse } from '@/api/bank-sync'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'
import { useRelativeTimeRefresh } from '@/hooks/useRelativeTimeRefresh'
import { useToast } from '@/hooks/useToast'
import {
  describeSyncNow,
  describeSyncNowBlock,
  SYNC_FAILED_MESSAGE,
} from '@/pages/accounts/detail/components/bank-link/syncNow'
import { callWhenPassed } from '@/utils/timing'

const SYNC_NOW_LABEL = 'Sync now'

function renderLabel(label: string) {
  return (
    <>
      <RefreshCw size={14} aria-hidden />
      {label}
    </>
  )
}

type SyncNowButtonProps = {
  link: BankLink
  connection: BankConnection | undefined
  providers: BankProvidersResponse | undefined

  /**
   * Marks the button as one of the view's actions, and for the modal to focus when it opens at the
   * bank link. The mark for the modal is dropped while the sync is held back, so the modal passes over
   * the button to the next action, as it passes over a field held with its reason
   */
  focusProps: Record<string, string>
}

/**
 * Asks for a sync of the linked account straight away. It reads Starting sync until a worker starts
 * the sync, then Sync started, after which the status shows the sync running. A sync asked for in
 * another window reads as starting too. Meanwhile a press does nothing, and the button keeps the
 * focus it holds, since a disabled one drops it to the page. That would stop Escape closing the
 * modal. Whatever holds the sync back disables it without the attribute too, with its reason in a
 * tooltip, and a press the server refuses says why in a toast. A spent request budget lets it go
 * once a request frees up, whether or not the connection has been read again since, and its reason is
 * worded again each minute until then, so when more requests are available stays current
 */
export function SyncNowButton({ link, connection, providers, focusProps }: SyncNowButtonProps) {
  const sync = useSyncBankAccount()
  const feedback = useActionFeedback()
  const { showToast } = useToast()
  const { buttonRef, style, measure } = useFittedButtonWidth(SYNC_NOW_LABEL, renderLabel)

  const [, renderAgain] = useReducer((count: number) => count + 1, 0)
  const budgetFreesAt = connection?.request_budget.available_again_at ?? null
  useEffect(() => callWhenPassed(budgetFreesAt, renderAgain), [budgetFreesAt])
  useRelativeTimeRefresh(() => describeSyncNowBlock(link, connection, providers) ?? '')

  const { status, block } = describeSyncNow(feedback.status, link, connection, providers)
  const busy = status !== 'idle'
  const { 'data-modal-initial-focus': initialFocus, ...actionProps } = focusProps

  const syncNow = () => {
    void feedback
      .run(() => sync.mutateAsync(link.account_id))
      .catch((cause: unknown) => {
        showToast({ status: 'error', text: cause instanceof ApiError ? cause.message : SYNC_FAILED_MESSAGE })
      })
  }

  return (
    <ActionFeedbackButton
      ref={buttonRef}
      type="button"
      status={status}
      loadingLabel="Starting sync"
      successLabel="Sync started"
      className="app-secondary-button relative h-9 w-full shrink-0 justify-center whitespace-nowrap px-3.5 text-sm sm:w-(--fit-width)"
      style={style}
      measure={measure}
      {...actionProps}
      data-modal-initial-focus={block === null ? initialFocus : undefined}
      disabledReason={block}
      onClick={busy ? undefined : syncNow}
    >
      <span className="inline-flex items-center gap-2">{renderLabel(SYNC_NOW_LABEL)}</span>
    </ActionFeedbackButton>
  )
}
