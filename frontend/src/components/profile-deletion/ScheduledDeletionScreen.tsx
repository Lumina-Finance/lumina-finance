import { useState } from 'react'
import { cancelProfileDeletion } from '@/api/user'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { DeletionDate } from '@/components/profile-deletion/DeletionDate'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { getSaveFailureMessage } from '@/utils/createFailure'
import { formatDeletionDueDate, isCancelTooLate } from '@/utils/profileDeletion'

const CANCEL_LABEL = 'Cancel deletion'

type ScheduledDeletionScreenProps = {
  /** When the profile is deleted, as an ISO time */
  dueAt: string
}

/**
 * Takes the place of the app while the profile waits to be deleted, so the user can cancel the deletion
 * or sign out, and does nothing else
 *
 * The server refuses every other request in this state, so no page could load its data anyway.
 * Cancelling hands the user back to the app, and a cancel that comes too late shows why and signs out
 */
export default function ScheduledDeletionScreen({ dueAt }: ScheduledDeletionScreenProps) {
  const { user, setUser, logout } = useAuth()
  const { showToast } = useToast()
  const [cancelling, setCancelling] = useState(false)

  async function cancelDeletion() {
    setCancelling(true)
    try {
      setUser(await cancelProfileDeletion())
      showToast({ status: 'success', text: 'Deletion cancelled' })
    } catch (error) {
      showToast({ status: 'error', text: getSaveFailureMessage(error) })
      setCancelling(false)
      if (isCancelTooLate(error)) await logout()
    }
  }

  return (
    <div
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
    >
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Your profile is scheduled for deletion</h1>

        <div className="mt-5 space-y-5">
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Your profile and data will be deleted on{' '}
            <DeletionDate>{formatDeletionDueDate(dueAt, user?.tz)}</DeletionDate>.
          </p>

          <div className="space-y-3">
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void cancelDeletion()}
                disabled={cancelling}
                aria-busy={cancelling}
                className={`app-primary-button ${cancelling ? 'app-primary-button-loading' : 'w-full'}`}
              >
                <PendingLabel pending={cancelling} name={CANCEL_LABEL}>
                  {CANCEL_LABEL}
                </PendingLabel>
              </button>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              disabled={cancelling}
              className="app-secondary-button w-full"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
