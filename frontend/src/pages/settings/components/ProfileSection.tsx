import type React from 'react'
import { useCurrencies } from '@/api/currency'
import Dropdown from '@/components/dropdown/Dropdown'
import SettingsField from '@/pages/settings/components/SettingsField'
import SettingsSectionHeader from '@/pages/settings/components/SettingsSectionHeader'
import SettingsCard from '@/pages/settings/components/SettingsCard'
import type { ProfileFormState } from '@/pages/settings/profileForm'

const TIMEZONES = Intl.supportedValuesOf('timeZone').map((tz) => ({
  value: tz,
  label: tz.replace(/_/g, ' '),
}))

const DISABLED_INPUT_STYLE: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed',
}

interface ProfileSectionProps {
  user: { first_name: string; last_name: string | null; email: string; base_currency: string } | null
  form: ProfileFormState
  onFieldChange: <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => void
  firstNameValid: boolean
  userInformationActions: React.ReactNode
  emailPasswordActions: React.ReactNode
}

export default function ProfileSection({
  user,
  form,
  onFieldChange,
  firstNameValid,
  userInformationActions,
  emailPasswordActions,
}: ProfileSectionProps) {
  const { data: currencies } = useCurrencies()
  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : ''
  const displayName = user
    ? `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`
    : ''

  // Fall back to the currency code until /currencies resolves, then render the
  // same code/name/symbol label format used by account creation.
  const baseCurrency = currencies?.find((c) => c.id === user?.base_currency)
  const baseCurrencyLabel = baseCurrency
    ? `${baseCurrency.id} — ${baseCurrency.name} (${baseCurrency.symbol})`
    : user?.base_currency ?? ''

  return (
    <section id="profile" className="scroll-mt-8">
      <SettingsSectionHeader
        title="Profile"
        description="Your name and localization defaults."
      />

      <div className="space-y-4">
        <SettingsCard>
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">User information</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Your identity and localization defaults.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold"
                style={{
                  background: 'linear-gradient(135deg, #C9A96A 0%, #9B6C2C 100%)',
                  color: '#1C1510',
                }}
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{displayName}</p>
              </div>
            </div>

            <div className="grid gap-4 min-[1500px]:grid-cols-2">
              <SettingsField label="First name">
                <input
                  className="app-input"
                  required
                  aria-invalid={!firstNameValid}
                  value={form.first_name}
                  onChange={(e) => onFieldChange('first_name', e.target.value)}
                />
              </SettingsField>
              <SettingsField label="Last name">
                <input
                  className="app-input"
                  value={form.last_name}
                  onChange={(e) => onFieldChange('last_name', e.target.value)}
                />
              </SettingsField>
              <SettingsField label="Timezone">
                <Dropdown
                  options={TIMEZONES}
                  value={form.tz}
                  onChange={(v) => onFieldChange('tz', v)}
                  searchable
                  searchPlaceholder="Search timezones..."
                />
              </SettingsField>
              <SettingsField label="Base currency" hint="Planned, currently not supported to change">
                <input
                  className="app-input"
                  value={baseCurrencyLabel}
                  disabled
                  style={DISABLED_INPUT_STYLE}
                />
              </SettingsField>
            </div>

            {userInformationActions}
          </div>
        </SettingsCard>

        <SettingsCard>
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Email and password</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Your login email and password settings.
              </p>
            </div>

            <div className="grid gap-4 min-[1500px]:grid-cols-2">
              <SettingsField label="Email" hint="Planned, currently not supported to change">
                <input
                  className="app-input"
                  type="email"
                  value={user?.email ?? ''}
                  disabled
                  style={DISABLED_INPUT_STYLE}
                />
              </SettingsField>
              <SettingsField label="Current password" hint="Planned, currently not supported to change">
                <input
                  className="app-input"
                  type="password"
                  placeholder="••••••••"
                  disabled
                  style={DISABLED_INPUT_STYLE}
                />
              </SettingsField>
              <SettingsField label="New password" hint="Planned, currently not supported to change">
                <input
                  className="app-input"
                  type="password"
                  placeholder="••••••••"
                  disabled
                  style={DISABLED_INPUT_STYLE}
                />
              </SettingsField>
              <SettingsField label="Confirm new password" hint="Planned, currently not supported to change">
                <input
                  className="app-input"
                  type="password"
                  placeholder="••••••••"
                  disabled
                  style={DISABLED_INPUT_STYLE}
                />
              </SettingsField>
            </div>

            {emailPasswordActions}
          </div>
        </SettingsCard>
      </div>
    </section>
  )
}
