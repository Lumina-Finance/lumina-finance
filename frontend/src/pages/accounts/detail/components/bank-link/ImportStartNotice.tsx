import { useRef } from 'react'
import { Clock } from 'lucide-react'
import { useStartBankImport } from '@/api/bank-sync'
import { IMPORT_START_REMINDER, START_IMPORT_FAILED_MESSAGE } from '@/components/bank-link-flow/constants'
import { InfoCallout } from '@/components/InfoCallout'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { useToast } from '@/hooks/useToast'
import { useMoveFocusOnFold } from '@/pages/accounts/detail/components/bank-link/useMoveFocusOnFold'
import { getSaveFailureMessage } from '@/utils/createFailure'

type ImportStartNoticeProps = {
  accountId: string

  /** The classes of the notice's button, the section's other notice actions' */
  actionClassName: string

  /** Moves focus on once the notice folds away with its button holding it */
  onFolded: () => void
}

/**
 * Tells the user the history import is waiting for the other accounts they link to join it, with Start
 * now to begin it at once. It is a real button in the notice's reading order, so a keyboard reaches it
 * by Tab, Enter or Space presses it, a touch taps it, and a screen reader hears the notice and then
 * a button named Start now. A press while it runs does nothing, and the button keeps its focus until the
 * import starts and the notice folds away, when focus moves on. A refusal says why in a toast and the
 * link list is read again
 */
export function ImportStartNotice({ accountId, actionClassName, onFolded }: ImportStartNoticeProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const start = useStartBankImport()
  const { showToast } = useToast()
  useMoveFocusOnFold(rootRef, onFolded)

  const run = () => {
    start.mutate(accountId, {
      onError: (cause) => showToast({ status: 'error', text: getSaveFailureMessage(cause, START_IMPORT_FAILED_MESSAGE) }),
    })
  }

  return (
    <div ref={rootRef}>
      <InfoCallout
        tone="info"
        icon={Clock}
        action={
          <button
            type="button"
            className={actionClassName}
            aria-busy={start.isPending}
            onClick={start.isPending ? undefined : run}
          >
            <PendingLabel pending={start.isPending} name="Start now">
              Start now
            </PendingLabel>
          </button>
        }
      >
        {IMPORT_START_REMINDER}
      </InfoCallout>
    </div>
  )
}
