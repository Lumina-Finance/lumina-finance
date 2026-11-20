import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { endOtherSessions } from '@/api/user'
import ActionFeedbackButton from '@/components/feedback/ActionButton'
import { StepUpModal, type StepUpCredentials } from '@/components/two-factor/StepUpModal'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'
import { ProviderReauthModal } from '@/pages/settings/components/security-section/ProviderReauthModal'
import { useProviderReauth } from '@/pages/settings/hooks/useProviderReauth'
import { getEndOtherSessionsBlockedReason } from '@/pages/settings/utils/endOtherSessions'

const END_OTHER_SESSIONS_LABEL = 'Sign out of all other devices'

interface EndOtherSessionsControlsProps {
  // False for an account with no password, whether it signs in through a provider or only a passkey. A
  // linked provider is then its way to confirm, and without one the button is held off
  hasPassword: boolean
}

/**
 * The security-card entry for signing out of every other device: a button that confirms it is you,
 * then ends every session but this browser's
 *
 * An account with a password steps up with it. A passwordless account has none, so it re-confirms
 * with a linked provider instead and returns here to finish
 */
export default function EndOtherSessionsControls({ hasPassword }: EndOtherSessionsControlsProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const reauth = useProviderReauth()
  const { run: runWithFeedback, status } = useActionFeedback()
  const { buttonRef, style, measure } = useFittedButtonWidth(END_OTHER_SESSIONS_LABEL)

  const [modalOpen, setModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A passwordless reauth returns here to finish the sign-out, then clears the state so a reload does
  // not run it again
  const resumeRef = useRef(false)
  useEffect(() => {
    if (resumeRef.current) return
    const navState = location.state as { resumeEndOtherSessions?: boolean } | null
    if (!navState?.resumeEndOtherSessions) return
    resumeRef.current = true
    navigate(location.pathname, { replace: true, state: null })

    runWithFeedback(() => endOtherSessions()).catch((resumeError: Error) =>
      setError(resumeError.message || 'Oops, something went wrong. Please try again.'),
    )
  }, [location.state, location.pathname, navigate, runWithFeedback])

  const start = () => {
    setError(null)
    if (hasPassword) {
      setModalOpen(true)
    } else {
      reauth.start({ kind: 'end-other-sessions' })
    }
  }

  const confirm = (credentials: StepUpCredentials) =>
    runWithFeedback(async () => {
      await endOtherSessions(credentials)
      setModalOpen(false)
    })

  const isLeaving = reauth.busySlug !== null

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Other devices</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            <span className="inline-block text-pretty">Sign out everywhere else your account is signed in.</span>{' '}
            <span className="inline-block text-pretty">You stay signed in on this browser.</span>
          </p>
        </div>
        <ActionFeedbackButton
          ref={buttonRef}
          type="button"
          status={isLeaving ? 'loading' : status}
          loadingLabel={isLeaving ? 'Re-confirming your identity' : 'Signing out'}
          successLabel="Signed out of all other devices"
          className="app-secondary-button relative shrink-0 justify-center whitespace-nowrap sm:w-(--fit-width)"
          style={style}
          measure={measure}
          disabled={isLeaving}
          disabledReason={getEndOtherSessionsBlockedReason(hasPassword, reauth.linkedProviders.length)}
          onClick={start}
        >
          {END_OTHER_SESSIONS_LABEL}
        </ActionFeedbackButton>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}

      <StepUpModal
        open={modalOpen}
        title={END_OTHER_SESSIONS_LABEL}
        description="Please confirm it's you. Every other browser and app will need to sign in again."
        requirePassword
        confirmLabel="Sign out"
        danger
        allowPasskey
        onClose={() => setModalOpen(false)}
        onVerify={confirm}
      />

      <ProviderReauthModal
        open={reauth.chooserOpen}
        providers={reauth.linkedProviders}
        busySlug={reauth.busySlug}
        onChoose={reauth.chooseProvider}
        onClose={reauth.closeChooser}
      />
    </>
  )
}
