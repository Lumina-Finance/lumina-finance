import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AnimatePresence, animate, motion } from 'motion/react'
import { ApiError, type AuthResponse } from '@/api/auth'
import { useAuth } from '@/hooks/useAuth'
import { NewPasswordForm } from '@/pages/auth/components/NewPasswordForm'
import { SignupFactorSetup } from '@/pages/auth/components/SignupFactorSetup'
import { AUTH_VIEW_TRANSITION } from '@/pages/auth/constants/authAnimations'
import { FADE_OUT_MS, emailFromConfirmationToken, getAuthErrorMessage } from '@/pages/auth/utils/authForm'
import { usePasskeyConfig } from '@/api/passkeys'
import { focusWhenShown } from '@/utils/focusWhenShown'
import { assessPasskeySupport } from '@/utils/passkeySupport'
import { isNewPasswordValid } from '@/utils/passwordPolicy'
import { AUTH_LOADING_MIN_MS, withMinDelay } from '@/utils/timing'

/**
 * Renders the page the sign-up confirmation email links to, where the person chooses their password
 * and the account is created
 *
 * The password is chosen here rather than at sign-up, so only whoever can read the email can set it.
 * Confirming signs the person in and offers the optional second-factor setup before the app
 */
const ConfirmEmailPage = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const { confirmSignup, primeAccessToken, setSession } = useAuth()
  const passkeyConfig = usePasskeyConfig()
  const containerRef = useRef<HTMLDivElement>(null)
  const pendingAuthRef = useRef<AuthResponse | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [enrolling, setEnrolling] = useState(false)

  // A link with no token cannot do anything, so send the visitor to log in
  if (!token) {
    return <Navigate to="/login" replace />
  }

  const canSubmit = !submitting && isNewPasswordValid(password) && confirmPassword === password

  const canUsePasskeys =
    passkeyConfig.data !== undefined && assessPasskeySupport(passkeyConfig.data.rp_id).supported

  /**
   * Creates the account, then moves to the second-factor offer with the new session held back until
   * the person finishes or skips it
   */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setError('')
    setSubmitting(true)
    try {
      // Hold the spinner for the shared minimum so a fast response does not flash it
      const res = await withMinDelay(() => confirmSignup({ token, new_password: password }), AUTH_LOADING_MIN_MS)
      pendingAuthRef.current = res
      primeAccessToken(res.access_token)
      setEnrolling(true)
    } catch (confirmError) {
      // A dead, spent or forged link and an address that has an account by now all read the same
      if (confirmError instanceof ApiError && confirmError.status === 400) {
        setLinkInvalid(true)
      } else {
        setError(getAuthErrorMessage(confirmError))
      }
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Fades out and routes to the given page so the cross-route change is not abrupt
   */
  const leaveTo = async (path: string) => {
    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    navigate(path, { replace: true })
  }

  /**
   * Leaves the second-factor step for the app, whether the person set one up or skipped it
   */
  const finishEnrollment = async () => {
    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: FADE_OUT_MS / 1000 })
    }
    if (pendingAuthRef.current) {
      setSession(pendingAuthRef.current)
    }
    navigate('/', { replace: true })
  }

  return (
    <motion.div
      ref={containerRef}
      className="flex min-h-[100dvh] items-start justify-center px-4 pt-[10dvh] lg:pt-[20dvh]"
      style={{ backgroundColor: 'var(--app-bg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl font-normal tracking-tight">
          {linkInvalid ? 'Link not valid' : enrolling ? 'Account created' : 'Choose a password'}
        </h1>

        <AnimatePresence mode="wait" initial={false}>
          {enrolling ? (
            <motion.div
              key="factor-enrollment"
              ref={focusWhenShown}
              tabIndex={-1}
              className="mt-5 outline-none"
              {...AUTH_VIEW_TRANSITION}
            >
              {/* Opt-in 2FA at signup is the account's first factor, so it steps up with the password just set */}
              <SignupFactorSetup
                passkeysSupported={canUsePasskeys}
                setupStepUp={{ password }}
                onFinish={finishEnrollment}
              />
            </motion.div>
          ) : linkInvalid ? (
            <motion.div
              key="link-invalid"
              ref={focusWhenShown}
              tabIndex={-1}
              className="mt-5 space-y-6 outline-none"
              {...AUTH_VIEW_TRANSITION}
            >
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }} role="alert">
                This confirmation link is invalid or has expired, or an account already exists for this email.
                Sign up again for a new link, or log in if you already have an account.
              </p>
              <p className="flex gap-6 text-sm">
                <button
                  type="button"
                  onClick={() => void leaveTo('/signup')}
                  className="font-medium underline underline-offset-2"
                  style={{ color: 'var(--app-accent)' }}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  onClick={() => void leaveTo('/login')}
                  className="font-medium underline underline-offset-2"
                  style={{ color: 'var(--app-accent)' }}
                >
                  Log in
                </button>
              </p>
            </motion.div>
          ) : (
            <motion.div key="confirm-form" {...AUTH_VIEW_TRANSITION}>
              <NewPasswordForm
                intro="Choose a password to finish creating your account."
                error={error}
                username={emailFromConfirmationToken(token)}
                password={password}
                confirmPassword={confirmPassword}
                passwordLabel="Password"
                confirmLabel="Confirm password"
                submitLabel="Create account"
                submitting={submitting}
                onPasswordChange={setPassword}
                onConfirmChange={setConfirmPassword}
                onSubmit={handleSubmit}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export default ConfirmEmailPage
