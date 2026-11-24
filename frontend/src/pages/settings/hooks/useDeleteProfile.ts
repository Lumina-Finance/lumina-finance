import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { deleteProfile } from '@/api/user'
import type { StepUpCredentials } from '@/components/two-factor/StepUpModal'
import { useAuth } from '@/hooks/useAuth'
import { useProviderReauth } from '@/pages/settings/hooks/useProviderReauth'
import { getEndOtherSessionsBlockedReason } from '@/pages/settings/utils/endOtherSessions'
import { noteProfileDeleted } from '@/utils/profileDeletedNotice'
import { formatDeletionDateFromToday } from '@/utils/profileDeletion'

/**
 * Drives Delete profile: the dialogue the user types "delete" in, then the identity check, then the sign-out
 *
 * An account with a password confirms in the step-up. A passwordless account re-confirms with a linked
 * provider instead and returns here, where the deletion finishes. Once the server answers, the app signs
 * out locally and lands on the sign-in screen. Signing out also drops this browser's saved copy
 *
 * Where a wait applies, the deletion only schedules, and the sign-in screen names the date the user can
 * cancel until. The wait is null while it is unknown. Until it arrives, a deletion a provider sign-in
 * resumed is held back, so the notice it leaves never misses the date
 *
 * @param hasPassword - Whether the account confirms with a password rather than a linked provider
 * @param waitDays - Days a deletion waits, 0 when it runs at once, or null until the answer arrives
 */
export function useDeleteProfile(hasPassword: boolean, waitDays: number | null) {
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

  const scheduledFor = waitDays ? formatDeletionDateFromToday(waitDays, user?.tz) : null

  // Signing out takes the app to the sign-in screen. That screen reads the notice and shows the deletion message
  const finish = useCallback(async () => {
    noteProfileDeleted(scheduledFor)
    await logout()
  }, [logout, scheduledFor])

  // A passwordless reauth returns here to finish the deletion, then clears the state so a reload does
  // not run it again
  const resumeRef = useRef(false)
  useEffect(() => {
    if (resumeRef.current || waitDays === null) return
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
  }, [location.state, location.pathname, navigate, finish, waitDays])

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
    await deleteProfile(credentials)
    setStepUpOpen(false)
    await finish()
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
