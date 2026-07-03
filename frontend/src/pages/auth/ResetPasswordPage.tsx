import type { FormEvent } from 'react'
import { useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { AnimatePresence, animate, motion } from 'motion/react'
import { ApiError, resetPassword } from '@/api/auth'
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'
import { AuthTextField } from '@/pages/auth/components/fields/TextField'
import { AUTH_VIEW_TRANSITION } from '@/pages/auth/constants/authAnimations'
import { NEW_PASSWORD_RULES, isNewPasswordValid } from '@/utils/passwordPolicy'

/**
 * Renders the password reset form reached from the emailed link, validating the new password
 * against the shared policy before sending the token and password to the backend
 */
const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // A reset link with no token cannot do anything, so send the visitor to log in
  if (!token) {
    return <Navigate to="/login" replace />
  }

  const newPasswordValid = isNewPasswordValid(newPassword)
  const confirmMatches = confirmPassword === newPassword
  const canSubmit = !submitting && newPasswordValid && confirmMatches
  const showRules = newPassword.length > 0
  const showMismatch = confirmPassword.length > 0 && !confirmMatches

  /**
   * Sends the token and new password, then shows a success state or a friendly failure message
   */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setError('')
    setSubmitting(true)
    try {
      await resetPassword({ token, new_password: newPassword })
      setDone(true)
    } catch (resetError) {
      const message =
        resetError instanceof ApiError && resetError.status === 400
          ? 'This reset link is invalid or has expired'
          : 'Something went wrong, please try again'
      setError(message)
    } finally {
      setSubmitting(false)
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
                {showRules && (
                  <ul className="mt-2 space-y-1">
                    {NEW_PASSWORD_RULES.map((rule) => {
                      const passed = rule.test(newPassword)
                      return (
                        <li key={rule.label} className="flex items-center gap-2 text-sm">
                          {passed ? (
                            <Check size={14} strokeWidth={2.5} style={{ color: 'var(--app-accent)' }} aria-hidden />
                          ) : (
                            <X size={14} strokeWidth={2.5} style={{ color: 'var(--app-text-muted)' }} aria-hidden />
                          )}
                          <span
                            className={passed ? 'line-through' : ''}
                            style={{ color: passed ? 'var(--app-text-subtle)' : 'var(--app-text-muted)' }}
                          >
                            {rule.label}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
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
