import { useRef } from 'react'
import { History } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useDismissCutOffDay, useDismissHistoryReminder, type BankHistoryReminder } from '@/api/bank-sync'
import { InfoCallout } from '@/components/InfoCallout'
import { useToast } from '@/hooks/useToast'
import { describeCutOffDay, describeHistoryReminder, DISMISS_FAILED_MESSAGE, type ReminderCopy } from '@/pages/accounts/detail/components/bank-link/reminders'

/** Marks each reminder, so focus leaving one that folds away can find the next */
export const REMINDER_ATTRIBUTE = 'data-bank-link-reminder'

type ReminderProps = {
  accountId: string
  providerName: string

  /** Moves focus on once a dismissal goes through, since the reminder folds away with the ✕ holding it */
  onDismissed: (reminder: HTMLElement) => void
}

type DismissCallbacks = {
  onSuccess: () => void
  onError: (cause: unknown) => void
}

type DismissibleReminderProps = {
  copy: ReminderCopy
  dismissing: boolean
  dismiss: (callbacks: DismissCallbacks) => void
  onDismissed: (reminder: HTMLElement) => void
}

/**
 * A reminder that history may be missing, in the review notices' colours, which the ✕ dismisses for
 * the import, catch-up or day that raised it. A press while it runs does nothing, and the ✕ keeps the
 * focus it holds until the dismissal goes through and focus inside moves on. A newer reminder in the
 * answer takes its place. A refused dismissal says why in a toast, and the account's bank link is
 * read again
 */
function DismissibleReminder({ copy, dismissing, dismiss, onDismissed }: DismissibleReminderProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  const run = () => dismiss({
    // Focus elsewhere stays where the person put it while the dismissal ran
    onSuccess: () => {
      if (rootRef.current?.contains(document.activeElement)) onDismissed(rootRef.current)
    },
    onError: (cause) => showToast({ status: 'error', text: cause instanceof ApiError ? cause.message : DISMISS_FAILED_MESSAGE }),
  })

  return (
    <div ref={rootRef} {...{ [REMINDER_ATTRIBUTE]: 'true' }}>
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
      dismiss={(callbacks) => dismissal.mutate({ accountId, reminder }, callbacks)}
      onDismissed={onDismissed}
    />
  )
}

/**
 * The reminder that some of a day's transactions may be missing, since the day brought back as many
 * as the provider sends at once
 */
export function CutOffDayReminder({ accountId, providerName, day, onDismissed }: ReminderProps & { day: string }) {
  const dismissal = useDismissCutOffDay()
  return (
    <DismissibleReminder
      copy={describeCutOffDay(day, providerName)}
      dismissing={dismissal.isPending}
      dismiss={(callbacks) => dismissal.mutate({ accountId, day }, callbacks)}
      onDismissed={onDismissed}
    />
  )
}
