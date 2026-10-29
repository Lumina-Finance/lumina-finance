import { useState } from 'react'
import { setPassword } from '@/api/user'
import { PasswordRequirements } from '@/components/PasswordRequirements'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { FormError } from '@/components/forms/FormError'
import { ModalContentFooter, ModalContentPanel } from '@/components/modal/ContentPanel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { isNewPasswordValid } from '@/utils/passwordPolicy'
import { withMinDelay } from '@/utils/timing'

const PASSWORD_FIELDS = ['newPassword', 'confirmPassword'] as const
const NEW_PASSWORD_ID = 'set_new_password'
const CONFIRM_PASSWORD_ID = 'set_confirm_password'
const CONTROL_IDS = { newPassword: NEW_PASSWORD_ID, confirmPassword: CONFIRM_PASSWORD_ID }

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
  const refusal = useRefusedSubmit(
    {
      // The rules list shows only once something is typed, so an empty field asks for a password instead
      newPassword: isNewPasswordValid(newPassword)
        ? undefined
        : newPassword.length === 0
          ? 'Enter a password'
          : 'Password must meet the rules',
      confirmPassword: confirmMatches
        ? undefined
        : confirmPassword.length === 0
          ? 'Confirm your password'
          : 'Passwords do not match',
    },
    PASSWORD_FIELDS,
    CONTROL_IDS,
  )

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting || !refusal.guard()) return

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

  // The modal stays mounted while closed, so a refusal from this visit is put away once it has gone
  const handleExitComplete = () => {
    refusal.reset()
    onExitComplete?.()
  }

  return (
    <ModalContentPanel
      open={open}
      onClose={onClose}
      closeDisabled={submitting}
      onExitComplete={handleExitComplete}
      titleId="set-password-title"
    >
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div className="space-y-1">
          <h3 id="set-password-title" className="text-base font-semibold">
            Set a password
          </h3>
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Choose a password to sign in with alongside your provider. Your other sessions will be signed out.
          </p>
        </div>

        <FormError message={error} />

        <div className="space-y-1.5">
          <FieldLabelRow
            label="New password"
            htmlFor={NEW_PASSWORD_ID}
            error={refusal.errors.newPassword}
            errorId="set_new_password-error"
          />
          <input
            id={NEW_PASSWORD_ID}
            className={`app-input ${refusal.errors.newPassword ? 'app-input-error' : ''}`}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={refusal.errors.newPassword ? true : undefined}
            aria-describedby={refusal.errors.newPassword ? 'set_new_password-error' : undefined}
            autoFocus
          />
          <PasswordRequirements
            password={newPassword}
            visible={newPassword.length > 0}
            animated
            animatedMarginTop={10}
            className="space-y-1 overflow-hidden"
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabelRow
            label="Confirm new password"
            htmlFor={CONFIRM_PASSWORD_ID}
            error={refusal.errors.confirmPassword}
            errorId="set_confirm_password-error"
          />
          <input
            id={CONFIRM_PASSWORD_ID}
            className={`app-input ${refusal.errors.confirmPassword ? 'app-input-error' : ''}`}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            onBlur={() => {
              if (confirmPassword.length > 0) refusal.touch('confirmPassword')
            }}
            aria-invalid={refusal.errors.confirmPassword ? true : undefined}
            aria-describedby={refusal.errors.confirmPassword ? 'set_confirm_password-error' : undefined}
          />
        </div>

        <ModalContentFooter>
          <div className="flex justify-center">
            <DisabledReasonButton
              type="submit"
              disabled={submitting}
              disabledReason={submitting ? undefined : refusal.blockedReason}
              className={`app-primary-button ${submitting ? 'app-primary-button-loading' : 'w-full'}`}
            >
              {submitting ? <div className="app-spinner" /> : 'Set password'}
            </DisabledReasonButton>
          </div>
        </ModalContentFooter>
      </form>
    </ModalContentPanel>
  )
}
