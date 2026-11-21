import type React from 'react'
import { FieldError } from '@/components/forms/FieldError'
import { PasswordRequirements } from '@/components/PasswordRequirements'
import SettingsCard from '@/pages/settings/components/Card'
import SettingsField from '@/pages/settings/components/Field'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import EndOtherSessionsControls from '@/pages/settings/components/security-section/EndOtherSessionsControls'
import MultiFactorControls from '@/pages/settings/components/security-section/MultiFactorControls'
import { SetPasswordControls } from '@/pages/settings/components/security-section/SetPasswordControls'
import SignInProviderControls from '@/pages/settings/components/security-section/SignInProviderControls'
import type { PasswordFormState } from '@/pages/settings/hooks/useSecuritySettingsForm'

const EMAIL_ERROR_ID = 'security-email-error'

/** What the Email field needs from the page: its text, why it is refused, and where its events go */
export type SecurityEmailField = {
  value: string
  error: string | null
  /** The notice that a confirmation email is on its way, shown under the card */
  sentMessage: string | null
  onChange: (value: string) => void
  onBlur: () => void
}

interface SecuritySectionProps {
  email: SecurityEmailField
  form: PasswordFormState
  onFieldChange: <K extends keyof PasswordFormState>(key: K, value: string) => void
  newPasswordValid: boolean
  confirmMatches: boolean
  // False for an account created through a provider, which sets a first password instead of changing one
  hasPassword: boolean
  // Discard and Save for the card's drafts, left out while a passwordless account has none changed
  actions: React.ReactNode
}

/**
 * Renders the editable account email and either the change-password form, with its live policy
 * checklist, or the set-a-first-password prompt for an account that signs in only through a provider
 */
export default function SecuritySection({
  email,
  form,
  onFieldChange,
  newPasswordValid,
  confirmMatches,
  hasPassword,
  actions,
}: SecuritySectionProps) {
  const showRules = form.newPassword.length > 0
  const showMismatch = form.confirmPassword.length > 0 && !confirmMatches

  return (
    <section id="security">
      <SettingsSectionHeader
        title="Security"
        description="Manage your account email, password, and two-factor authentication."
      />

      <div className="space-y-4">
        <SettingsCard>
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Email and password</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Your login email and account password.
              </p>
            </div>

            <SettingsField
              label="Email"
              htmlFor="security-email"
              labelAccessory={
                <FieldError message={email.error} id={EMAIL_ERROR_ID} className="ml-auto min-w-0 shrink" />
              }
            >
              <input
                id="security-email"
                className={`app-input ${email.error ? 'app-input-error' : ''}`}
                type="email"
                autoComplete="email"
                aria-invalid={email.error ? true : undefined}
                aria-describedby={email.error ? EMAIL_ERROR_ID : undefined}
                value={email.value}
                onChange={(e) => email.onChange(e.target.value)}
                onBlur={email.onBlur}
              />
            </SettingsField>

            {hasPassword ? (
              <div className="space-y-4">
                <SettingsField label="Current password" htmlFor="security-current-password">
                  <input
                    id="security-current-password"
                    className="app-input"
                    type="password"
                    autoComplete="current-password"
                    value={form.currentPassword}
                    onChange={(e) => onFieldChange('currentPassword', e.target.value)}
                  />
                </SettingsField>

                <SettingsField label="New password" htmlFor="security-new-password">
                  <input
                    id="security-new-password"
                    className="app-input"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={form.newPassword.length > 0 && !newPasswordValid}
                    value={form.newPassword}
                    onChange={(e) => onFieldChange('newPassword', e.target.value)}
                  />
                  <PasswordRequirements password={form.newPassword} visible={showRules} />
                </SettingsField>

                <SettingsField label="Confirm new password" htmlFor="security-confirm-password">
                  <input
                    id="security-confirm-password"
                    className="app-input"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={showMismatch}
                    value={form.confirmPassword}
                    onChange={(e) => onFieldChange('confirmPassword', e.target.value)}
                  />
                  {showMismatch && (
                    <span className="block text-xs" style={{ color: 'var(--app-negative)' }}>
                      Passwords do not match
                    </span>
                  )}
                </SettingsField>
              </div>
            ) : (
              <SetPasswordControls />
            )}

            {actions}

            <div className="border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
              <MultiFactorControls hasPassword={hasPassword} />
            </div>

            <div className="border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
              <SignInProviderControls />
            </div>

            <div className="border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
              <EndOtherSessionsControls hasPassword={hasPassword} />
            </div>
          </div>
        </SettingsCard>

        {email.sentMessage && (
          <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {email.sentMessage}
          </p>
        )}
      </div>
    </section>
  )
}
