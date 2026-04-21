import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  User as UserIcon,
  Milestone,
  Check,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts, type AccountsOverview } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  useRunwayAccounts,
  useUpdateProfile,
  useUpdateRunwayAccounts,
  type UpdateProfilePayload,
} from '@/api/user'
import Dropdown from '@/components/Dropdown'

// IANA timezone list, sourced from the browser at module-load so it stays in
// sync with the signup page. Underscores are swapped for spaces purely for
// display — the stored value is the canonical IANA name.
const TIMEZONES = Intl.supportedValuesOf('timeZone').map((tz) => ({
  value: tz,
  label: tz.replace(/_/g, ' '),
}))

// Applied to every field that's currently read-only so the user sees a clear
// visual signal (dimmed + not-allowed cursor) on top of the native HTML
// `disabled` state, which the app-input class otherwise overrides.
const DISABLED_INPUT_STYLE: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed',
}

type SectionId = 'profile' | 'runway'

interface Section {
  id: SectionId
  label: string
  icon: LucideIcon
}

const SECTIONS: Section[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'runway', label: 'Runway', icon: Milestone },
]

/* ── Top-level page ── */

export default function Settings() {
  const { user, setUser } = useAuth()
  const { data: accounts, isLoading: accountsLoading } = useAccounts()
  const { data: serverSelection, isLoading: selectionLoading } = useRunwayAccounts()
  const updateProfile = useUpdateProfile()
  const updateRunway = useUpdateRunwayAccounts()

  // ── Profile draft ──
  // Effective form value = base (from user) + overrides. Derived on every
  // render so when `user` updates after save, the form auto-resets with no
  // effect-based sync.
  const [profileOverrides, setProfileOverrides] = useState<Partial<ProfileFormState>>({})
  const profileBase: ProfileFormState = user
    ? profileFormFromUser(user)
    : { first_name: '', last_name: '', tz: '' }
  const profileForm: ProfileFormState = { ...profileBase, ...profileOverrides }
  const setProfileField = <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) =>
    setProfileOverrides((o) => ({ ...o, [key]: value }))

  const isProfileDirty = user
    ? profileForm.first_name !== user.first_name
      || (profileForm.last_name === '' ? null : profileForm.last_name) !== user.last_name
      || profileForm.tz !== user.tz
    : false
  // first_name is required on the backend (min_length=1) — block a blank save
  // client-side so the Save button disables instead of round-tripping a 422.
  const firstNameValid = profileForm.first_name.trim().length > 0

  // ── Runway draft ──
  // `null` means "untouched — follow the server state"; once the user flips any
  // tile we snapshot the current server set into a mutable Set the user edits.
  const [runwayDraft, setRunwayDraft] = useState<Set<string> | null>(null)
  const runwayServerSet = useMemo(() => new Set(serverSelection ?? []), [serverSelection])
  const runwaySelection = runwayDraft ?? runwayServerSet
  // Only open asset accounts are eligible. Credit products (credit cards,
  // lines of credit, HELOCs) are borrowed headroom — treating them as runway
  // inflates the number against real cushion. Loans and mortgages are debt
  // that doesn't contribute either. Liability accounts are excluded outright.
  const selectableAccounts = useMemo(
    () =>
      (accounts ?? []).filter(
        (a) => a.closed_at === null && a.account_kind === 'asset',
      ),
    [accounts],
  )
  const toggleRunwayAccount = (id: string) => {
    setRunwayDraft((prev) => {
      const next = new Set(prev ?? runwayServerSet)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const isRunwayDirty = useMemo(() => {
    if (!runwayDraft) return false
    if (runwayDraft.size !== runwayServerSet.size) return true
    for (const id of runwayDraft) if (!runwayServerSet.has(id)) return true
    return false
  }, [runwayDraft, runwayServerSet])

  // ── Combined save/discard ──
  // Save has three visible states. `saving` holds for at least 1s so a fast
  // API response still gets visible feedback; `saved` then briefly confirms
  // success with a checkmark before returning to `idle`.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const isDirty = isProfileDirty || isRunwayDirty
  const isPending = saveStatus !== 'idle'
  const canSave = isDirty && !isPending && (!isProfileDirty || firstNameValid)

  const handleSave = async () => {
    if (!canSave || !user) return

    setSaveStatus('saving')
    const startTime = Date.now()

    const requests: Promise<unknown>[] = []

    if (isProfileDirty) {
      // Patch only the fields that actually changed. last_name translates ""
      // → null so the backend clears the column instead of storing "".
      const patch: UpdateProfilePayload = {}
      if (profileForm.first_name !== user.first_name) patch.first_name = profileForm.first_name.trim()
      const nextLast = profileForm.last_name === '' ? null : profileForm.last_name
      if (nextLast !== user.last_name) patch.last_name = nextLast
      if (profileForm.tz !== user.tz) patch.tz = profileForm.tz

      requests.push(
        updateProfile.mutateAsync(patch).then((updated) => {
          setUser(updated)
          setProfileOverrides({})
        }),
      )
    }

    if (isRunwayDirty && runwayDraft) {
      requests.push(
        updateRunway.mutateAsync(Array.from(runwayDraft)).then(() => {
          setRunwayDraft(null)
        }),
      )
    }

    const results = await Promise.allSettled(requests)
    const anyFailed = results.some((r) => r.status === 'rejected')

    // Hold `saving` until at least 1s has elapsed so the feedback is visible
    // even on fast networks.
    const elapsed = Date.now() - startTime
    if (elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed))

    if (anyFailed) {
      // Error surfaces via the mutation's own error state; drop back to idle
      // so the user can retry.
      setSaveStatus('idle')
      return
    }

    // Brief confirmation flash, then back to idle.
    setSaveStatus('saved')
    await new Promise((r) => setTimeout(r, 1200))
    setSaveStatus('idle')
  }

  const handleDiscard = () => {
    setProfileOverrides({})
    setRunwayDraft(null)
  }

  // ── Scroll-spy sidebar ──
  const [activeSection, setActiveSection] = useState<SectionId>('profile')
  // Suppress the IntersectionObserver while a programmatic scroll is settling,
  // so clicks don't briefly flash the wrong item active.
  const skipObserverRef = useRef(false)

  const navigateToSection = (id: SectionId) => {
    const el = document.getElementById(id)
    if (!el) return
    skipObserverRef.current = true
    setActiveSection(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => { skipObserverRef.current = false }, 600)
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (skipObserverRef.current) return
        const topVisible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (topVisible) setActiveSection(topVisible.target.id as SectionId)
      },
      { root: null, rootMargin: '-20% 0px -55% 0px', threshold: [0.2, 0.4, 0.6] },
    )

    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  // Pick whichever save-path failed to surface above the buttons. Both at
  // once is rare (independent endpoints, parallel mutations) but we still
  // render profile first if present.
  const saveError = updateProfile.isError
    ? ((updateProfile.error as Error)?.message ?? 'Failed to save profile.')
    : updateRunway.isError
      ? ((updateRunway.error as Error)?.message ?? 'Failed to save runway selection.')
      : null

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">Settings</h1>
        <p className="app-page-description">
          Manage your profile and runway preferences.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10 lg:items-start">
        {/* Sidebar — sticky on desktop, hidden on mobile (sections just stack) */}
        <aside className="hidden lg:block sticky top-6">
          <nav className="space-y-0.5" aria-label="Settings sections">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const isActive = activeSection === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => navigateToSection(s.id)}
                  className={`app-nav-link ${isActive ? 'app-nav-link-active' : ''}`}
                >
                  <Icon size={17} strokeWidth={isActive ? 2 : 1.75} className="shrink-0" aria-hidden />
                  {s.label}
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-10">
          <ProfileSection
            user={user}
            form={profileForm}
            onFieldChange={setProfileField}
            firstNameValid={firstNameValid}
          />
          <RunwaySection
            loading={accountsLoading || selectionLoading}
            accounts={selectableAccounts}
            selection={runwaySelection}
            onToggle={toggleRunwayAccount}
          />

          {/* Unified save bar — covers both profile + runway in parallel */}
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end sm:items-center">
            {saveError && (
              <p className="text-sm sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                {saveError}
              </p>
            )}
            <button
              type="button"
              className="app-secondary-button"
              onClick={handleDiscard}
              disabled={!isDirty || isPending}
            >
              Discard
            </button>
            <motion.button
              type="button"
              className="app-primary-button"
              onClick={handleSave}
              disabled={!canSave && saveStatus === 'idle'}
              layout
              transition={{ layout: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] } }}
              style={saveStatus === 'saved' ? {
                background: 'var(--app-positive)',
                borderColor: 'var(--app-positive)',
                color: '#fff',
                transition: 'background 250ms ease, border-color 250ms ease, color 250ms ease',
              } : {
                transition: 'background 250ms ease, border-color 250ms ease, color 250ms ease',
              }}
            >
              {saveStatus === 'saved' ? (
                <motion.span
                  layout="position"
                  className="inline-flex items-center gap-1.5"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 480, damping: 22 }}
                >
                  <Check size={16} strokeWidth={2.5} aria-hidden />
                  Saved
                </motion.span>
              ) : saveStatus === 'saving' ? (
                <motion.span layout="position" aria-label="Saving">
                  <div className="app-spinner" />
                </motion.span>
              ) : (
                <motion.span layout="position">Save</motion.span>
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Shared primitives ── */

function SectionHeader({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h2
        className="font-serif font-medium tracking-tight"
        style={{ fontSize: 'clamp(1.5rem, 2.2vw, 2rem)', lineHeight: 1.1 }}
      >
        {title}
      </h2>
      <div className="text-base mt-1 space-y-2" style={{ color: 'var(--app-text-muted)' }}>
        {typeof description === 'string' ? <p>{description}</p> : description}
      </div>
    </div>
  )
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5 sm:p-6"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      {children}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  // Plain <div>, not <label>. A <label> wrapper re-dispatches clicks onto
  // the first labelable control inside it, which reopens a Dropdown that just
  // closed on option selection. The visual label is the span below.
  return (
    <div className="space-y-1.5 block">
      <span className="app-label block">{label}</span>
      {children}
      {hint && (
        <span className="block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

/* ── Profile ── */

interface ProfileFormState {
  first_name: string
  last_name: string
  tz: string
}

// last_name is stored as "" (not null) in the form so the input stays
// controlled; we translate "" back to null on save so the backend clears
// the column instead of storing an empty string.
function profileFormFromUser(user: {
  first_name: string
  last_name: string | null
  tz: string
}): ProfileFormState {
  return {
    first_name: user.first_name,
    last_name: user.last_name ?? '',
    tz: user.tz,
  }
}

interface ProfileSectionProps {
  user: { first_name: string; last_name: string | null; email: string; base_currency: string } | null
  form: ProfileFormState
  onFieldChange: <K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) => void
  firstNameValid: boolean
}

function ProfileSection({ user, form, onFieldChange, firstNameValid }: ProfileSectionProps) {
  const { data: currencies } = useCurrencies()
  const initials = user
    ? `${user.first_name[0] ?? ''}${user.last_name?.[0] ?? ''}`.toUpperCase()
    : ''
  const displayName = user
    ? `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`
    : ''

  // Format the base currency with its full name and symbol. Until the
  // cached /currencies fetch resolves we fall back to just the code so the
  // field never flashes empty — first paint shows "CAD", then upgrades to
  // "CAD — Canadian Dollar ($)" once currencies arrive (matches the format
  // used in the account creation modal).
  const baseCurrency = currencies?.find((c) => c.id === user?.base_currency)
  const baseCurrencyLabel = baseCurrency
    ? `${baseCurrency.id} — ${baseCurrency.name} (${baseCurrency.symbol})`
    : user?.base_currency ?? ''

  return (
    <section id="profile" className="scroll-mt-8">
      <SectionHeader
        title="Profile"
        description="Your name and localization defaults."
      />

      <SettingsCard>
        <div className="space-y-6">
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

          {/* Name + localization fields. Base currency is shown alongside so
              the user sees the full picture; it visibly dims via
              DISABLED_INPUT_STYLE on top of the HTML disabled attribute. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name">
              <input
                className="app-input"
                required
                aria-invalid={!firstNameValid}
                value={form.first_name}
                onChange={(e) => onFieldChange('first_name', e.target.value)}
              />
            </Field>
            <Field label="Last name">
              <input
                className="app-input"
                value={form.last_name}
                onChange={(e) => onFieldChange('last_name', e.target.value)}
              />
            </Field>
            <Field label="Timezone">
              <Dropdown
                options={TIMEZONES}
                value={form.tz}
                onChange={(v) => onFieldChange('tz', v)}
                searchable
                searchPlaceholder="Search timezones..."
              />
            </Field>
            <Field label="Base currency" hint="Planned, currently not supported to change">
              <input
                className="app-input"
                value={baseCurrencyLabel}
                disabled
                style={DISABLED_INPUT_STYLE}
              />
            </Field>
          </div>

          {/* Divider between identity/localization and the account/security
              group (email + passwords). */}
          <div style={{ borderTop: '1px solid var(--app-border)' }} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email" hint="Planned, currently not supported to change">
              <input
                className="app-input"
                type="email"
                value={user?.email ?? ''}
                disabled
                style={DISABLED_INPUT_STYLE}
              />
            </Field>
            <Field label="Current password" hint="Planned, currently not supported to change">
              <input
                className="app-input"
                type="password"
                placeholder="••••••••"
                disabled
                style={DISABLED_INPUT_STYLE}
              />
            </Field>
            <Field label="New password" hint="Planned, currently not supported to change">
              <input
                className="app-input"
                type="password"
                placeholder="••••••••"
                disabled
                style={DISABLED_INPUT_STYLE}
              />
            </Field>
            <Field label="Confirm new password" hint="Planned, currently not supported to change">
              <input
                className="app-input"
                type="password"
                placeholder="••••••••"
                disabled
                style={DISABLED_INPUT_STYLE}
              />
            </Field>
          </div>
        </div>
      </SettingsCard>
    </section>
  )
}

/* ── Runway ── */

interface RunwaySectionProps {
  loading: boolean
  accounts: AccountsOverview[]
  selection: Set<string>
  onToggle: (id: string) => void
}

function RunwaySection({ loading, accounts, selection, onToggle }: RunwaySectionProps) {
  return (
    <section id="runway" className="scroll-mt-8">
      <SectionHeader
        title="Runway"
        description={
          <>
            <p>
              Pick which accounts should count toward calculating your runway — how long the total balance in the selected accounts will last assuming your average monthly spend for the last 12 months (or the maximum available history) doesn't change. Only open asset accounts are eligible; liabilities like credit cards or loans can't be counted.
            </p>
            <p>
              For example, if your selected accounts hold $30,000 and you've averaged $5,000 a month in spending, that's a 6-month runway.
            </p>
          </>
        }
      />

      <SettingsCard>
        {loading ? (
          <div className="h-24 rounded-lg bg-gray-300" />
        ) : accounts.length === 0 ? (
          <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            No eligible accounts yet. Add an asset account to configure runway.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((account) => (
                <RunwayAccountTile
                  key={account.id}
                  account={account}
                  selected={selection.has(account.id)}
                  onToggle={() => onToggle(account.id)}
                />
              ))}
            </div>
            <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
              {selection.size} of {accounts.length} selected
            </p>
          </div>
        )}
      </SettingsCard>
    </section>
  )
}

function RunwayAccountTile({
  account,
  selected,
  onToggle,
}: {
  account: AccountsOverview
  selected: boolean
  onToggle: () => void
}) {
  const institutionName = account.institution?.name ?? 'Cash'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200"
      style={{
        background: selected ? 'var(--app-accent-soft)' : 'var(--app-input-bg)',
        border: `1px solid ${selected ? 'var(--app-accent-border)' : 'var(--app-input-border)'}`,
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{
          background: selected ? 'var(--app-accent)' : 'transparent',
          border: `1px solid ${selected ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
          color: '#1C1510',
        }}
      >
        {selected && <Check size={13} strokeWidth={3} aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium truncate">{account.name}</span>
        <span className="block text-xs truncate" style={{ color: 'var(--app-text-muted)' }}>
          {institutionName}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        <span
          className="block font-financial text-sm font-medium"
          style={{
            color:
              account.current_balance > 0
                ? 'var(--app-positive)'
                : account.current_balance < 0
                  ? 'var(--app-negative)'
                  : 'var(--app-text)',
          }}
        >
          {formatCurrency(account.current_balance, account.currency)}
        </span>
        {/* Available credit = limit + signed balance, since liability balances
            are stored negative. Matches the pattern used on the Accounts page. */}
        {account.credit_limit !== null && (
          <span
            className="block font-financial text-xs"
            style={{ color: 'var(--app-text-muted)' }}
          >
            {formatCurrency(account.credit_limit + account.current_balance, account.currency)} avail.
          </span>
        )}
      </span>
    </button>
  )
}
