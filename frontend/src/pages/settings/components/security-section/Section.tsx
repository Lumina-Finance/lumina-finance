import { Check, X } from 'lucide-react'
import type React from 'react'
import SettingsCard from '@/pages/settings/components/Card'
import SettingsField from '@/pages/settings/components/Field'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import MultiFactorControls from '@/pages/settings/components/security-section/MultiFactorControls'
import { NEW_PASSWORD_RULES } from '@/utils/passwordPolicy'
import type { PasswordFormState } from '@/pages/settings/hooks/useSecuritySettingsForm'

const DISABLED_INPUT_STYLE: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed',
}

interface SecuritySectionProps {
  email: string
  form: PasswordFormState
  onFieldChange: <K extends keyof PasswordFormState>(key: K, value: string) => void
  newPasswordValid: boolean
  confirmMatches: boolean
  actions: React.ReactNode
}

/**
 * Renders the account email, the change-password form, and its live policy checklist
 */
export default function SecuritySection({
  email,
  form,
  onFieldChange,
  newPasswordValid,
  confirmMatches,
  actions,
}: SecuritySectionProps) {
  const showRules = form.newPassword.length > 0
  const showMismatch = form.confirmPassword.length > 0 && !confirmMatches

  return (
    <section id="security" className="scroll-mt-8">
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

            <SettingsField label="Email" hint="Planned, currently not supported to change">
              <input className="app-input" type="email" value={email} disabled style={DISABLED_INPUT_STYLE} />
            </SettingsField>

            <div className="space-y-4">
              <SettingsField label="Current password">
                <input
                  className="app-input"
                  type="password"
                  autoComplete="current-password"
                  value={form.currentPassword}
                  onChange={(e) => onFieldChange('currentPassword', e.target.value)}
                />
              </SettingsField>

              <SettingsField label="New password">
                <input
                  className="app-input"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={form.newPassword.length > 0 && !newPasswordValid}
                  value={form.newPassword}
                  onChange={(e) => onFieldChange('newPassword', e.target.value)}
                />
                {showRules && (
                  <ul className="space-y-1">
                    {NEW_PASSWORD_RULES.map((rule) => {
                      const passed = rule.test(form.newPassword)
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
              </SettingsField>

              <SettingsField label="Confirm new password">
                <input
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

            {actions}

            <div className="border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
              <MultiFactorControls />
            </div>
          </div>
        </SettingsCard>
      </div>
    </section>
  )
}
