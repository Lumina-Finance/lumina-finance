import type { FormEvent, ReactNode } from 'react'
import { PasswordRequirements } from '@/components/PasswordRequirements'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'
import { AuthTextField } from '@/pages/auth/components/fields/TextField'
import { isNewPasswordValid } from '@/utils/passwordPolicy'

type NewPasswordFormProps = {
  intro: string
  error: string
  password: string
  confirmPassword: string
  passwordLabel: string
  confirmLabel: string
  submitLabel: string
  submitting: boolean
  // Shown read-only so a password manager saves the password against the account's email
  username?: string
  onPasswordChange: (value: string) => void
  onConfirmChange: (value: string) => void
  onSubmit: (event: FormEvent) => void
  // Extra controls under the submit button
  children?: ReactNode
}

/**
 * Renders the choose-a-password form shared by the sign-up confirmation and password reset pages
 *
 * The submit button explains itself while the password breaks a rule or the two entries differ, and
 * a mismatch tints the confirmation field and marks it invalid for assistive technology
 */
export function NewPasswordForm({
  intro,
  error,
  password,
  confirmPassword,
  passwordLabel,
  confirmLabel,
  submitLabel,
  submitting,
  username,
  onPasswordChange,
  onConfirmChange,
  onSubmit,
  children,
}: NewPasswordFormProps) {
  const passwordValid = isNewPasswordValid(password)
  const confirmMatches = confirmPassword === password
  const blockReason = submitting
    ? undefined
    : !passwordValid
      ? 'Choose a password that meets the rules first'
      : !confirmMatches
        ? 'Enter the same password in both fields first'
        : undefined

  return (
    <form onSubmit={onSubmit} className="mt-5" noValidate>
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {intro}
      </p>

      <AuthErrorBanner error={error} />

      {username !== undefined && (
        <div className="mt-5 space-y-1.5">
          <span id="username-label" className="app-label">
            Email
          </span>
          {/* Text rather than an input, which cuts a long address at its edge instead of wrapping it */}
          <p
            aria-labelledby="username-label"
            className="app-input h-auto break-all py-2 leading-snug"
            style={{ color: 'var(--app-text-muted)' }}
          >
            {username}
          </p>
          <input
            type="email"
            autoComplete="username"
            className="sr-only"
            value={username}
            readOnly
            tabIndex={-1}
            aria-hidden
          />
        </div>
      )}

      <div className="mt-5">
        <AuthTextField
          id="new-password"
          label={passwordLabel}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={onPasswordChange}
        />
        <PasswordRequirements password={password} visible={password.length > 0} className="mt-2 space-y-1" />
      </div>

      <div className="mt-5">
        <AuthTextField
          id="confirm-new-password"
          label={confirmLabel}
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={onConfirmChange}
          error="Passwords do not match"
          touched={confirmPassword.length > 0 && !confirmMatches}
        />
      </div>

      <div className="mt-5 flex justify-center">
        <DisabledReasonButton
          type="submit"
          disabled={submitting}
          disabledReason={blockReason}
          className={`app-primary-button transition-all duration-300 ${
            submitting ? 'app-primary-button-loading' : 'w-full'
          }`}
        >
          {submitting ? <div className="app-spinner" /> : submitLabel}
        </DisabledReasonButton>
      </div>

      {children}
    </form>
  )
}
