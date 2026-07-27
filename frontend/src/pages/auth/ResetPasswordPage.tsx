import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { AnimatePresence, animate, motion } from 'motion/react'
import { ApiError, resetPassword, verifyResetMfa } from '@/api/auth'
import type { MfaRequiredResponse } from '@/api/auth'
import { usePasskeyConfig, useVerifyPasskeyReset } from '@/api/passkeys'
import { OTP_LENGTH } from '@/components/OtpInput'
import { PasswordRequirements } from '@/components/PasswordRequirements'
import { MfaChallenge } from '@/components/two-factor/MfaChallenge'
import { useAuth } from '@/hooks/useAuth'
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'
import { AuthTextField } from '@/pages/auth/components/fields/TextField'
import { AUTH_VIEW_TRANSITION } from '@/pages/auth/constants/authAnimations'
import { getAuthErrorMessage } from '@/pages/auth/utils/authForm'
import { getPasskeySignInMessage, isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors'
import { assessPasskeySupport } from '@/utils/passkeySupport'
import { AUTH_LOADING_MIN_MS, withMinDelay } from '@/utils/timing'
import { isNewPasswordValid } from '@/utils/passwordPolicy'

/**
 * Renders the password reset form reached from the emailed link, validating the new password
 * against the shared policy before sending the token and password to the backend
 *
 * An account with an active second factor gets the same verification step as login before the
 * password changes, passkey-first with authenticator and recovery-code fallbacks
 */
const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const passkeyConfig = usePasskeyConfig()
  const passkeyReset = useVerifyPasskeyReset()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [challenge, setChallenge] = useState<MfaRequiredResponse | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaUsePasskey, setMfaUsePasskey] = useState(false)
  const [mfaUseRecoveryCode, setMfaUseRecoveryCode] = useState(false)
  const [mfaSubmitting, setMfaSubmitting] = useState(false)

  // A reset link with no token cannot do anything, so send the visitor to log in
  if (!token) {
    return <Navigate to="/login" replace />
  }

  const newPasswordValid = isNewPasswordValid(newPassword)
  const confirmMatches = confirmPassword === newPassword
  const canSubmit = !submitting && newPasswordValid && confirmMatches
  const showRules = newPassword.length > 0
  const showMismatch = confirmPassword.length > 0 && !confirmMatches

  // The passkey option only shows where a ceremony can actually run, matching the login screen
  const canUsePasskeys =
    passkeyConfig.data !== undefined && assessPasskeySupport(passkeyConfig.data.rp_id).supported

  /**
   * Maps a reset failure to a friendly message, treating a dead link as its own case
   */
  const describeResetError = (resetError: unknown): string => {
    if (resetError instanceof ApiError && resetError.status === 400) {
      return 'This reset link is invalid or has expired'
    }
    return getAuthErrorMessage(resetError)
  }

  /**
   * Sends the token and new password, then completes, challenges for a factor, or reports failure
   */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setError('')
    setSubmitting(true)
    try {
      // Hold the spinner for the shared minimum so a fast response does not flash it
      const result = await withMinDelay(() => resetPassword({ token, new_password: newPassword }), AUTH_LOADING_MIN_MS)
      if (result === null) {
        setDone(true)
      } else {
        setChallenge(result)
        setMfaUsePasskey(result.passkey_available && canUsePasskeys)
        setMfaUseRecoveryCode(result.recovery_only)
      }
    } catch (resetError) {
      setError(describeResetError(resetError))
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Drops a spent or failed challenge so the password form can request a fresh one
   */
  const returnToPasswordForm = (message: string) => {
    setChallenge(null)
    setMfaCode('')
    setMfaSubmitting(false)
    setError(message)
  }

  /**
   * Verifies the typed code, finishing the reset or entering the forced re-enrolment session
   */
  const handleVerifyCode = async (event: FormEvent) => {
    event.preventDefault()
    if (!challenge || mfaSubmitting) return
    const code = mfaUseRecoveryCode ? mfaCode.trim() : mfaCode
    const codeReady = mfaUseRecoveryCode ? code.length > 0 : code.length >= OTP_LENGTH
    if (!codeReady) return

    setError('')
    setMfaSubmitting(true)
    try {
      // Hold the spinner for the shared minimum so a fast response does not flash it
      const session = await withMinDelay(
        () =>
          verifyResetMfa({
            token,
            new_password: newPassword,
            mfa_token: challenge.mfa_token,
            code,
          }),
        AUTH_LOADING_MIN_MS,
      )
      if (session === null) {
        setDone(true)
        return
      }

      // A recovery code wiped every factor, so enter the restricted session that re-enrols one
      setSession(session)
      navigate('/', { replace: true })
    } catch (verifyError) {
      // The challenge is single use, so a rejected code returns to the form for a fresh attempt
      returnToPasswordForm(describeResetError(verifyError))
    }
  }

  /**
   * Switches the second-factor step from the passkey to the authenticator code input
   */
  const switchToAuthenticatorMfa = () => {
    setMfaUsePasskey(false)
    setMfaUseRecoveryCode(false)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor step to a recovery code
   */
  const switchToRecoveryMfa = () => {
    setMfaUsePasskey(false)
    setMfaUseRecoveryCode(true)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor step back to the passkey prompt
   */
  const switchToPasskeyMfa = () => {
    setMfaUsePasskey(true)
    setMfaCode('')
    setError('')
  }

  /**
   * Switches the second-factor input between an authenticator code and a recovery code
   */
  const toggleMfaRecoveryCode = () => {
    setMfaUseRecoveryCode((current) => !current)
    setMfaCode('')
    setError('')
  }

  /**
   * Runs the passkey ceremony for the reset challenge, ignoring a cancelled browser prompt
   */
  const handleVerifyPasskey = async () => {
    if (!challenge || passkeyReset.isPending) return

    setError('')
    try {
      await passkeyReset.mutateAsync({
        token,
        new_password: newPassword,
        mfa_token: challenge.mfa_token,
      })
      setDone(true)
    } catch (passkeyError) {
      if (isPasskeyCeremonyCancelled(passkeyError)) return
      if (passkeyError instanceof ApiError) {
        returnToPasswordForm(describeResetError(passkeyError))
        return
      }
      setError(getPasskeySignInMessage(passkeyError))
    }
  }

  /**
   * Fades the page out before returning to login so the cross-route change is not abrupt
   */
  const goToLogin = async () => {
    if (containerRef.current) {
      await animate(containerRef.current, { opacity: 0 }, { duration: 0.2 })
    }
    navigate('/login', { replace: true })
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
        <h1 className="font-serif text-4xl font-normal tracking-tight">Password Reset</h1>

        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.div key="reset-success" className="mt-5 space-y-6" {...AUTH_VIEW_TRANSITION}>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Your password has been reset. You can now log in with your new password.
              </p>
              <button
                type="button"
                onClick={goToLogin}
                className="font-medium underline underline-offset-2"
                style={{ color: 'var(--app-accent)' }}
              >
                Go to login
              </button>
            </motion.div>
          ) : challenge ? (
            <motion.div
              key={`reset-mfa-${mfaUsePasskey ? 'passkey' : mfaUseRecoveryCode ? 'recovery' : 'code'}`}
              className="mt-5 space-y-6"
              {...AUTH_VIEW_TRANSITION}
            >
              <AuthErrorBanner error={error} />

              <MfaChallenge
                challenge={{
                  canEnterAuthenticatorCode: challenge.totp_enabled,
                  // The reset screen only offers a passkey where this browser can run the ceremony,
                  // unlike sign-in, which does not gate the option on browser support
                  canOfferPasskey: challenge.passkey_available && canUsePasskeys,
                  isRecoveryOnly: challenge.recovery_only,
                }}
                usePasskey={mfaUsePasskey}
                useRecoveryCode={mfaUseRecoveryCode}
                code={mfaCode}
                onCodeChange={setMfaCode}
                submitting={mfaSubmitting}
                passkeySubmitting={passkeyReset.isPending}
                onSubmitCode={handleVerifyCode}
                onVerifyPasskey={handleVerifyPasskey}
                onSwitchToAuthenticator={switchToAuthenticatorMfa}
                onSwitchToRecovery={switchToRecoveryMfa}
                onSwitchToPasskey={switchToPasskeyMfa}
                onToggleRecoveryCode={toggleMfaRecoveryCode}
                onCancel={goToLogin}
                passkeyVerifyDescription="Verify with your passkey to finish resetting your password."
                hasAncestorForm={false}
              />
            </motion.div>
          ) : (
            <motion.form
              key="reset-form"
              onSubmit={handleSubmit}
              className="mt-5"
              noValidate
              {...AUTH_VIEW_TRANSITION}
            >
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Choose a new password for your account.
              </p>

              <AuthErrorBanner error={error} />

              <div className="mt-5">
                <AuthTextField
                  id="new-password"
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={setNewPassword}
                />
                <PasswordRequirements password={newPassword} visible={showRules} className="mt-2 space-y-1" />
              </div>

              <div className="mt-5">
                <AuthTextField
                  id="confirm-new-password"
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                />
                {showMismatch && (
                  <span className="mt-1.5 block text-xs" style={{ color: 'var(--app-negative)' }}>
                    Passwords do not match
                  </span>
                )}
              </div>

              <div className="mt-5 flex justify-center">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={`app-primary-button transition-all duration-300 ${
                    submitting ? 'app-primary-button-loading' : 'w-full'
                  }`}
                >
                  {submitting ? <div className="app-spinner" /> : 'Reset password'}
                </button>
              </div>

              <p className="mt-5 text-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
                <button
                  type="button"
                  onClick={goToLogin}
                  className="font-medium underline underline-offset-2"
                  style={{ color: 'var(--app-accent)' }}
                >
                  Back to login
                </button>
              </p>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

export default ResetPasswordPage
