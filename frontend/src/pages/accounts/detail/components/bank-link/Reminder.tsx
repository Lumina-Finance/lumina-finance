import { useRef } from 'react'
import { History } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useDismissHistoryReminder, type BankHistoryReminder } from '@/api/bank-sync'
import { InfoCallout } from '@/components/InfoCallout'
import { useToast } from '@/hooks/useToast'
import { describeHistoryReminder, DISMISS_FAILED_MESSAGE, type ReminderCopy } from '@/pages/accounts/detail/components/bank-link/reminders'

type ReminderProps = {
  accountId: string
  providerName: string

  /** Moves focus on once a dismissal goes through, since the reminder folds away with the ✕ holding it */
  onDismissed: () => void
}

type DismissCallbacks = {
  /** Called with whether the answer still shows a reminder of this kind, a newer one raised meanwhile */
  onSuccess: (stillShown: boolean) => void
  onError: (cause: unknown) => void
}

type DismissibleReminderProps = {
  copy: ReminderCopy
  dismissing: boolean
  dismiss: (callbacks: DismissCallbacks) => void
  onDismissed: () => void
}

/**
 * A reminder that history may be missing, in the review notices' colours, which the ✕ dismisses for
 * the import or catch-up that raised it. A press while it runs does nothing, and the ✕ keeps the
 * focus it holds until the dismissal goes through and focus inside moves on. A newer reminder in the
 * answer takes its place, keeping the ✕ and its focus. A refused dismissal says why in a toast, and
 * the account's bank link is read again
 */
function DismissibleReminder({ copy, dismissing, dismiss, onDismissed }: DismissibleReminderProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  const run = () => dismiss({
    // Focus elsewhere stays where the person put it while the dismissal ran
    onSuccess: (stillShown) => {
      if (!stillShown && rootRef.current?.contains(document.activeElement)) onDismissed()
    },
    onError: (cause) => showToast({ status: 'error', text: cause instanceof ApiError ? cause.message : DISMISS_FAILED_MESSAGE }),
  })

  return (
    <div ref={rootRef}>
      <InfoCallout tone="review" icon={History} title={copy.title} dismissing={dismissing} onDismiss={run}>
        {copy.body}
      </InfoCallout>
    </div>
  )
}

/**
 * The reminder that the link's last import or catch-up that fell short returned less history than it
 * asked for, or none
 */
export function HistoryReminder({ accountId, providerName, reminder, onDismissed }: ReminderProps & { reminder: BankHistoryReminder }) {
  const dismissal = useDismissHistoryReminder()
  return (
    <DismissibleReminder
      copy={describeHistoryReminder(reminder, providerName)}
      dismissing={dismissal.isPending}
      dismiss={({ onSuccess, onError }) => dismissal.mutate(
        { accountId, reminder },
        { onSuccess: (status) => onSuccess(status.link?.history_reminder != null), onError },
      )}
      onDismissed={onDismissed}
    />
  )
}
