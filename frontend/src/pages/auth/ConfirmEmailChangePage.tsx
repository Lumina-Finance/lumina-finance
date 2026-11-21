import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError, confirmEmailChange } from '@/api/auth'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { useAuth } from '@/hooks/useAuth'
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'
import { AUTH_VIEW_TRANSITION } from '@/pages/auth/constants/authAnimations'
import { getAuthErrorMessage } from '@/pages/auth/utils/authForm'
import { focusWhenShown } from '@/utils/focusWhenShown'
import { AUTH_LOADING_MIN_MS, withMinDelay } from '@/utils/timing'

type View = { name: 'ready' } | { name: 'changed'; email: string } | { name: 'invalid' }

const CONFIRM_LABEL = 'Confirm email'

/**
 * Renders the page the email-change confirmation email links to, where a click changes the account's
 * email to the address that received the link
 *
 * Opening the link changes nothing, since a mail scanner that fetches it would otherwise spend it. It
 * works signed in or out, as the person usually opens it in the browser they asked from. Confirming ends
 * every session of the account, this browser's included, so the page clears the signed-in state it holds
 * and sends the person to log in with the new address
 */
const ConfirmEmailChangePage = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const { user, logout } = useAuth()
  const [view, setView] = useState<View>({ name: 'ready' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // A link with no token cannot do anything, so send the visitor to log in
  if (!token) {
    return <Navigate to="/login" replace />
  }

  /**
   * Changes the email, then drops the session this browser holds, since the change has just ended it
   */
  const handleConfirm = async () => {
    if (submitting) return
    setError('')
    setSubmitting(true)
    try {
      const { email } = await withMinDelay(() => confirmEmailChange(token), AUTH_LOADING_MIN_MS)
      if (user) await logout()
      setView({ name: 'changed', email })
    } catch (confirmError) {
      // A dead, spent, replaced or forged link and an address another account took all read the same
      if (confirmError instanceof ApiError && confirmError.status === 400) {
        setView({ name: 'invalid' })
      } else {
        setError(getAuthErrorMessage(confirmError))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl font-normal tracking-tight">
          {view.name === 'changed'
            ? 'Email changed'
            : view.name === 'invalid'
              ? 'Link not valid'
              : 'Confirm your new email'}
        </h1>

        <AnimatePresence mode="wait" initial={false}>
          {view.name === 'ready' ? (
            <motion.div key="ready" className="mt-5 space-y-6" {...AUTH_VIEW_TRANSITION}>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Please confirm to change your email. You'll be signed out of every device.
              </p>
              <AuthErrorBanner error={error} />
              <div className="flex justify-center">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleConfirm()}
                  className={`app-primary-button ${submitting ? 'app-primary-button-loading' : 'w-full'}`}
                >
                  <PendingLabel pending={submitting} name={CONFIRM_LABEL}>
                    {CONFIRM_LABEL}
                  </PendingLabel>
                </button>
              </div>
            </motion.div>
          ) : view.name === 'changed' ? (
            <motion.div
              key="changed"
              ref={focusWhenShown}
              tabIndex={-1}
              className="mt-5 space-y-6 outline-none"
              {...AUTH_VIEW_TRANSITION}
            >
              <p className="break-words text-sm" style={{ color: 'var(--app-text-muted)' }} role="status">
                Your email is now {view.email}. Please log in with it.
              </p>
              <LogInLink />
            </motion.div>
          ) : (
            <motion.div
              key="invalid"
              ref={focusWhenShown}
              tabIndex={-1}
              className="mt-5 space-y-6 outline-none"
              {...AUTH_VIEW_TRANSITION}
            >
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }} role="alert">
                This confirmation link is invalid or has expired. Please request a new one in Security settings.
              </p>
              <LogInLink />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/**
 * The way on from either result: the login page, or the app for a browser still signed in
 */
function LogInLink() {
  return (
    <p className="text-sm">
      <Link
        to="/login"
        replace
        className="font-medium underline underline-offset-2"
        style={{ color: 'var(--app-accent)' }}
      >
        Log in
      </Link>
    </p>
  )
}

export default ConfirmEmailChangePage
