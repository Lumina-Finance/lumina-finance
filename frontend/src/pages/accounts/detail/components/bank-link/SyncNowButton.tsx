import { RefreshCw } from 'lucide-react'
import type { BankConnection, BankLink, BankProvidersResponse } from '@/api/bank-sync'
import { BANK_SYNC_NOT_SET_UP_REASON } from '@/components/bank-link-flow/constants'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'
import { useSyncNow } from '@/pages/accounts/detail/components/bank-link/useSyncNow'

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

  /** The id of the line under the actions that prints the reason bank sync isn't set up */
  notSetUpReasonId: string
}

/**
 * Asks for a sync of the linked account straight away, or while the import waits for the user's other
 * accounts to join it, starts the import at once. It reads Starting sync until a worker starts
 * the sync, then Sync underway, after which the status shows the sync running. A sync asked for in
 * another window reads as starting too. Meanwhile a press does nothing, and the button keeps the
 * focus it holds, since a disabled one drops it to the page. That would stop Escape closing the
 * modal. Whatever holds the sync back disables it without the attribute too, with its reason in a
 * tooltip, and a press the server refuses says why in a toast. A spent request budget lets it go
 * once a request frees up, whether or not the connection has been read again since, and its reason is
 * worded again each minute until then, so when more requests are available stays current. When bank
 * sync isn't set up the reason is printed under the actions, so the button points at that line
 */
export function SyncNowButton({ link, connection, providers, focusProps, notSetUpReasonId }: SyncNowButtonProps) {
  const { buttonRef, style, measure } = useFittedButtonWidth(SYNC_NOW_LABEL, renderLabel)
  const { status, block, busy, syncNow } = useSyncNow(link, connection, providers)
  const { 'data-modal-initial-focus': initialFocus, ...actionProps } = focusProps

  return (
    <ActionFeedbackButton
      ref={buttonRef}
      type="button"
      status={status}
      loadingLabel="Starting sync"
      successLabel="Sync underway"
      className="app-secondary-button relative h-9 w-full shrink-0 justify-center whitespace-nowrap px-3.5 text-sm sm:w-(--fit-width)"
      style={style}
      measure={measure}
      {...actionProps}
      data-modal-initial-focus={block === null ? initialFocus : undefined}
      disabledReason={block}
      reasonShownById={block === BANK_SYNC_NOT_SET_UP_REASON ? notSetUpReasonId : undefined}
      onClick={busy ? undefined : syncNow}
    >
      <span className="inline-flex items-center gap-2">{renderLabel(SYNC_NOW_LABEL)}</span>
    </ActionFeedbackButton>
  )
}
