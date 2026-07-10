import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { setPassword } from '@/api/user'
import { TwoFactorModalShell } from '@/components/twoFactor/TwoFactorModalShell'
import { isNewPasswordValid, NEW_PASSWORD_RULES } from '@/utils/passwordPolicy'
import { withMinDelay } from '@/utils/timing'

// Password feedback grows and shrinks the modal, so height, fade, and the gap above each block animate
// together. Animating marginTop rather than leaving a static margin keeps the gap from snapping in the
// frame the block mounts, which also lets the content-sized panel resize smoothly instead of jumping
const PASSWORD_FEEDBACK_TRANSITION = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }

interface SetPasswordModalProps {
  open: boolean
  onClose: () => void
  onDone: () => void
  // Runs after the modal has animated out, so the caller can refresh state without cutting the exit short
  onExitComplete?: () => void
}

/**
 * Collects and sets the first password for a passwordless account after its provider reauth
 *
 * The reauth already armed the httpOnly authorization cookie, so this only gathers the new password
 * and submits it. Success signs out the account's other sessions on the server
 */
export function SetPasswordModal({ open, onClose, onDone, onExitComplete }: SetPasswordModalProps) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmMatches = confirmPassword.length > 0 && confirmPassword === newPassword
  const submitDisabled = submitting || !isNewPasswordValid(newPassword) || !confirmMatches

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitDisabled) return

    setSubmitting(true)
    setError(null)
    try {
      // Hold the spinner to the shared minimum so a fast set does not flash the loading state
      await withMinDelay(() => setPassword({ new_password: newPassword }))
      onDone()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not set the password.')
      setSubmitting(false)
    }
  }

  return (
    <TwoFactorModalShell open={open} onClose={onClose} closeDisabled={submitting} onExitComplete={onExitComplete}>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-1">
          <h3 className="text-base font-semibold">Set a password</h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Choose a password to sign in with alongside your provider. Your other sessions will be
            signed out.
          </p>
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
            {error}
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="set_new_password" className="app-label block">
            New password
          </label>
          <input
            id="set_new_password"
            className="app-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoFocus
          />
          <AnimatePresence initial={false}>
            {newPassword.length > 0 && (
              <motion.ul
                className="space-y-1 overflow-hidden"
                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                animate={{ height: 'auto', opacity: 1, marginTop: 10 }}
                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                transition={PASSWORD_FEEDBACK_TRANSITION}
              >
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
              </motion.ul>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="set_confirm_password" className="app-label block">
            Confirm new password
          </label>
          <input
            id="set_confirm_password"
            className="app-input"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          <AnimatePresence initial={false}>
            {confirmPassword.length > 0 && !confirmMatches && (
              <motion.div
                className="overflow-hidden text-xs"
                style={{ color: 'var(--app-negative)' }}
                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                animate={{ height: 'auto', opacity: 1, marginTop: 6 }}
                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                transition={PASSWORD_FEEDBACK_TRANSITION}
              >
                Passwords do not match
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex justify-center">
          <button
            type="submit"
            disabled={submitDisabled}
            className={`app-primary-button transition-all duration-300 ${submitting ? 'app-primary-button-loading' : 'w-full'}`}
          >
            {submitting ? <div className="app-spinner" /> : 'Set password'}
          </button>
        </div>
      </form>
    </TwoFactorModalShell>
  )
}
