import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { deleteProfile, type ProfileDeletionResult } from '@/api/user'
import type { StepUpCredentials } from '@/components/two-factor/StepUpModal'
import { useAuth } from '@/hooks/useAuth'
import { useProviderReauth } from '@/pages/settings/hooks/useProviderReauth'
import { getEndOtherSessionsBlockedReason } from '@/pages/settings/utils/endOtherSessions'
import { noteProfileDeleted } from '@/utils/profileDeletedNotice'
import { formatDeletionDateAfterWait, formatDeletionDueDate } from '@/utils/profileDeletion'

/**
 * Drives Delete profile: the dialogue the user types "delete" in, then the identity check, then the sign-out
 *
 * An account with a password confirms in the step-up. A passwordless account re-confirms with a linked
 * provider instead and returns here, where the deletion finishes. Once the server answers, the app signs
 * out locally and lands on the sign-in screen. Signing out also drops this browser's saved copy
 *
 * Where a wait applies, the deletion only schedules, and the sign-in screen names the date the server
 * answered with. The dialogue names the date the wait would end on, from the wait alone
 *
 * @param hasPassword - Whether the account confirms with a password rather than a linked provider
 * @param waitSeconds - Seconds a deletion waits, 0 when it runs at once
 */
export function useDeleteProfile(hasPassword: boolean, waitSeconds: number) {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const reauth = useProviderReauth()
  const [dialogueOpen, setDialogueOpen] = useState(false)
  // Counts the openings, so each one starts a fresh dialogue that asks for the word again
  const [openings, setOpenings] = useState(0)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  // A provider sign-in returns here with the deletion to finish, so the page opens already busy
  const [resuming, setResuming] = useState(
    () => (location.state as { resumeDeleteProfile?: boolean } | null)?.resumeDeleteProfile === true,
  )
  const [error, setError] = useState<string | null>(null)

  const scheduledFor = waitSeconds > 0 ? formatDeletionDateAfterWait(waitSeconds, user?.tz) : null

  // Signing out takes the app to the sign-in screen. That screen reads the notice and shows the deletion
  // message, with the date the server scheduled when there is one
  const finish = useCallback(
    async ({ deletion_due_at }: ProfileDeletionResult) => {
      noteProfileDeleted(deletion_due_at ? formatDeletionDueDate(deletion_due_at, user?.tz) : null)
      await logout()
    },
    [logout, user?.tz],
  )

  // A passwordless reauth returns here to finish the deletion, then clears the state so a reload does
  // not run it again
  const resumeRef = useRef(false)
  useEffect(() => {
    if (resumeRef.current) return
    const navState = location.state as { resumeDeleteProfile?: boolean } | null
    if (!navState?.resumeDeleteProfile) return
    resumeRef.current = true
    navigate(location.pathname, { replace: true, state: null })

    deleteProfile()
      .then(finish)
      .catch((resumeError: Error) => {
        setResuming(false)
        setError(resumeError.message || 'Oops, something went wrong. Please try again.')
      })
  }, [location.state, location.pathname, navigate, finish])

  const open = () => {
    setError(null)
    setOpenings((count) => count + 1)
    setDialogueOpen(true)
  }

  /** The user typed "delete", so the identity check comes next */
  const confirmTyped = () => {
    setDialogueOpen(false)
    if (hasPassword) {
      setStepUpOpen(true)
    } else {
      reauth.start({ kind: 'delete-profile' })
    }
  }

  const verify = async (credentials: StepUpCredentials) => {
    const result = await deleteProfile(credentials)
    setStepUpOpen(false)
    await finish(result)
  }

  return {
    dialogueOpen,
    dialogueKey: openings,
    scheduledFor,
    open,
    cancel: () => setDialogueOpen(false),
    confirmTyped,
    stepUpOpen,
    closeStepUp: () => setStepUpOpen(false),
    verify,
    reauth,
    leaving: reauth.busySlug !== null,
    // True while the deletion a provider sign-in resumed is on its way to the server
    resuming,
    // Confirming takes what signing out of other devices takes, so it is held off for the same accounts
    blockedReason: getEndOtherSessionsBlockedReason(hasPassword, reauth.linkedProviders.length),
    error,
  }
}
