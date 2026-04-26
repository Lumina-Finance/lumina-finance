import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  User as UserIcon,
  AlertTriangle,
  LifeBuoy,
  Landmark,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts, useUpdateAccount, type AccountsOverview } from '@/api/accounts'
import { useCurrencies, type Currency } from '@/api/currency'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  useCreateTaxAdvantagedPlan,
  useCreateTaxAdvantagedPlanLimit,
  useDeleteTaxAdvantagedPlan,
  useDeleteTaxAdvantagedPlanLimit,
  useTaxAdvantagedPlanLimits,
  useTaxAdvantagedPlans,
  useUpdateTaxAdvantagedPlan,
  useUpdateTaxAdvantagedPlanLimit,
  type TaxAdvantagedPlan,
  type TaxAdvantagedPlanLimit,
  type TaxTreatment,
} from '@/api/taxAdvantagedPlans'
import {
  useRunwayAccounts,
  useUpdateProfile,
  useUpdateRunwayAccounts,
  type UpdateProfilePayload,
} from '@/api/user'
import ActionFeedbackButton from '@/components/ActionFeedbackButton'
import Dropdown from '@/components/Dropdown'
import { useActionFeedback } from '@/hooks/useActionFeedback'

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

const CATEGORY_SUMMARY_LABEL_CLASS = 'app-label mb-1 block h-5 truncate leading-5'
const CATEGORY_SUMMARY_VALUE_CLASS = 'flex h-6 items-center truncate text-[0.9375rem] font-medium leading-6'
const CATEGORY_FIELD_TRANSITION = {
  duration: 0.1,
  ease: 'easeOut' as const,
}
const LIMIT_DELETE_BUTTON_TRANSITION = {
  duration: 0.1,
  ease: 'easeOut' as const,
}

type SectionId = 'profile' | 'runway' | 'tax-advantaged-categories'

interface Section {
  id: SectionId
  label: string
  icon: LucideIcon
}

const SECTIONS: Section[] = [
  { id: 'profile', label: 'Profile', icon: UserIcon },
  { id: 'runway', label: 'Runway', icon: LifeBuoy },
  { id: 'tax-advantaged-categories', label: 'Tax-Advantaged Categories', icon: Landmark },
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
  const saveFeedback = useActionFeedback()
  const saveStatus = saveFeedback.status
  const isDirty = isProfileDirty || isRunwayDirty
  const isPending = saveFeedback.isPending
  const canSave = isDirty && !isPending && (!isProfileDirty || firstNameValid)

  const handleSave = async () => {
    if (!canSave || !user) return

    try {
      await saveFeedback.run(async () => {
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
        const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
        if (failed) throw failed.reason
      })
    } catch {
      // Mutation errors already surface through the existing save error text.
    }
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
          Manage your profile, runway preferences, and tax-advantaged categories.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10 lg:items-start">
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

          <TaxAdvantagedCategoriesSection
            accounts={accounts ?? []}
            userBaseCurrency={user?.base_currency}
            userTimezone={user?.tz}
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
            <ActionFeedbackButton
              type="button"
              className="app-primary-button w-[72px]"
              onClick={handleSave}
              disabled={!canSave && saveStatus === 'idle'}
              loadingLabel="Saving"
              status={saveStatus}
            >
              Save
            </ActionFeedbackButton>
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

/* ── Tax-advantaged categories ── */

const TAX_TREATMENT_OPTIONS: { value: TaxTreatment; label: string }[] = [
  { value: 'tax_free', label: 'Exempt' },
  { value: 'tax_deferred', label: 'Deferred' },
  { value: 'tax_assisted', label: 'Assisted' },
]

const DEFAULT_NEW_LIMIT_YEAR = new Date().getFullYear()
const MAX_VISIBLE_LIMIT_ROWS = 5
const LIMIT_DELETE_FEEDBACK_MS = 600

interface TaxPlanFormState {
  name: string
  tax_treatment: TaxTreatment
  currency: string
  lifetime_contribution_limit: string
}

interface TaxPlanLimitFormState {
  year: string
  contribution_limit: string
  withdrawal_limit: string
}

interface AutosaveNotice {
  status: 'saving' | 'saved' | 'error'
  message: string
}

type CategoryModalTab = 'limits' | 'accounts'

function currencyOptions(currencies: Currency[]) {
  return currencies.map((c) => ({ value: c.id, label: `${c.id} — ${c.name} (${c.symbol})` }))
}

function currencyExponent(currencies: Currency[], code: string) {
  return currencies.find((c) => c.id === code)?.minor_unit_exponent ?? 2
}

function currencySymbol(currencies: Currency[], code: string) {
  return currencies.find((c) => c.id === code)?.symbol ?? ''
}

function sanitizeMoneyInput(value: string) {
  let sanitized = value.replace(/[^\d.]/g, '')
  const parts = sanitized.split('.')
  if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`
  if (sanitized.startsWith('.')) sanitized = `0${sanitized}`
  return sanitized
}

function formatMoneyInput(value: string, currencies: Currency[], code: string) {
  if (!value.trim() || !isValidMoneyInput(value)) return value
  const exponent = currencyExponent(currencies, code)
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(value))
}

function isValidMoneyInput(value: string, required = false) {
  const trimmed = value.trim()
  if (!trimmed) return !required
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0
}

function toMinorUnits(value: string, currencies: Currency[], code: string) {
  if (!value.trim()) return null
  const multiplier = Math.pow(10, currencyExponent(currencies, code))
  return Math.round(Number(value) * multiplier)
}

function fromMinorUnits(value: number | null, currencies: Currency[], code: string) {
  if (value === null) return ''
  const exponent = currencyExponent(currencies, code)
  const major = value / Math.pow(10, exponent)
  return exponent === 0 ? String(Math.round(major)) : Number(major.toFixed(exponent)).toString()
}

function formatTaxTreatment(value: TaxTreatment) {
  return TAX_TREATMENT_OPTIONS.find((option) => option.value === value)?.label ?? value
}

function currentYearForTimezone(timeZone?: string) {
  if (!timeZone) return new Date().getFullYear()

  try {
    return Number(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric' }).format(new Date()))
  } catch {
    return new Date().getFullYear()
  }
}

function formatLimitYears(years: number[]) {
  const uniqueYears = [...new Set(years)].sort((a, b) => a - b)
  if (uniqueYears.length === 0) return 'None'
  if (uniqueYears.length === 1) return `${uniqueYears[0]} only`

  const isContiguous = uniqueYears.every((year, index) => index === 0 || year === uniqueYears[index - 1] + 1)
  const span = isContiguous
    ? `${uniqueYears[0]}-${uniqueYears[uniqueYears.length - 1]}`
    : uniqueYears.length <= 3
      ? uniqueYears.join(', ')
      : `${uniqueYears.length} years configured`

  if (!isContiguous && uniqueYears.length > 3) return span
  return `${span} · ${uniqueYears.length} years`
}

function autosaveNoticeColor(status: AutosaveNotice['status']) {
  if (status === 'error') return 'var(--app-negative)'
  if (status === 'saved') return 'var(--app-positive)'
  return 'var(--app-accent)'
}

function AutosaveStatusIcon({ status }: { status: AutosaveNotice['status'] }) {
  const Icon = status === 'error' ? AlertTriangle : status === 'saved' ? Check : LoaderCircle

  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
      style={{
        background: autosaveNoticeColor(status),
        color: 'var(--app-bg)',
      }}
    >
      <Icon
        size={16}
        strokeWidth={status === 'saving' ? 2.4 : 3}
        className={status === 'saving' ? 'animate-spin' : undefined}
        aria-hidden
      />
    </span>
  )
}

function CurrencyInput({
  ariaLabel,
  currencies,
  currency,
  onBlur,
  onChange,
  placeholder,
  required = false,
  value,
}: {
  ariaLabel?: string
  currencies: Currency[]
  currency: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  value: string
}) {
  const [focused, setFocused] = useState(false)
  const symbol = currencySymbol(currencies, currency)
  const displayValue = focused ? value : formatMoneyInput(value, currencies, currency)

  return (
    <div className="relative">
      {symbol && (
        <span
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
          style={{
            color: 'var(--app-text-subtle)',
            fontSize: '0.9375rem',
            lineHeight: 1,
          }}
          aria-hidden
        >
          {symbol}
        </span>
      )}
      <input
        aria-label={ariaLabel}
        className={`app-input w-full ${symbol ? 'pl-8' : ''}`}
        inputMode="decimal"
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onChange={(event) => onChange(sanitizeMoneyInput(event.target.value))}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        required={required}
        type="text"
        value={displayValue}
      />
    </div>
  )
}

function InlineCurrencyInput({
  ariaLabel,
  currencies,
  currency,
  onBlur,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string
  currencies: Currency[]
  currency: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  const [focused, setFocused] = useState(false)
  const symbol = currencySymbol(currencies, currency)
  const displayValue = focused ? value : formatMoneyInput(value, currencies, currency)

  return (
    <div
      className="group flex h-6 min-w-0 items-center gap-1"
      style={{ borderBottom: '1px solid var(--app-border-strong)' }}
    >
      {symbol && (
        <span className="shrink-0 text-[0.9375rem]" style={{ color: 'var(--app-text-subtle)' }} aria-hidden>
          {symbol}
        </span>
      )}
      <input
        aria-label={ariaLabel}
        className="block h-6 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-6 outline-none"
        inputMode="decimal"
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onChange={(event) => onChange(sanitizeMoneyInput(event.target.value))}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        style={{ color: 'var(--app-text)' }}
        type="text"
        value={displayValue}
      />
      <Pencil
        size={13}
        className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
    </div>
  )
}

function CompactCurrencyInput({
  ariaLabel,
  currencies,
  currency,
  onBlur,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string
  currencies: Currency[]
  currency: string
  onBlur?: () => void
  onChange: (value: string) => void
  placeholder?: string
  value: string
}) {
  const [focused, setFocused] = useState(false)
  const symbol = currencySymbol(currencies, currency)
  const displayValue = focused ? value : formatMoneyInput(value, currencies, currency)

  return (
    <div
      className="group flex h-9 w-full min-w-0 items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors duration-150 hover:border-[var(--app-border)] focus-within:border-[var(--app-accent-border)]"
      style={{ background: 'color-mix(in srgb, var(--app-input-bg) 55%, var(--app-bg))' }}
    >
      {symbol && (
        <span className="shrink-0 text-[0.9375rem]" style={{ color: 'var(--app-text-subtle)' }} aria-hidden>
          {symbol}
        </span>
      )}
      <input
        aria-label={ariaLabel}
        className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
        inputMode="decimal"
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
        onChange={(event) => onChange(sanitizeMoneyInput(event.target.value))}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        style={{ color: 'var(--app-text)' }}
        type="text"
        value={displayValue}
      />
      <Pencil
        size={13}
        className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
    </div>
  )
}

function InlineTaxTreatmentSelect({
  onBlur,
  onChange,
  value,
}: {
  onBlur?: () => void
  onChange: (value: TaxTreatment) => void
  value: TaxTreatment
}) {
  return (
    <div
      className="group flex h-6 min-w-0 items-center gap-1"
      style={{ borderBottom: '1px solid var(--app-border-strong)' }}
    >
      <select
        aria-label="Category type"
        className="block h-6 min-w-0 flex-1 appearance-none bg-transparent text-[0.9375rem] font-medium leading-6 outline-none"
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value as TaxTreatment)}
        style={{ color: 'var(--app-text)' }}
        value={value}
      >
        {TAX_TREATMENT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Pencil
        size={13}
        className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
    </div>
  )
}

function TaxAdvantagedCategoriesSection({
  accounts,
  userBaseCurrency,
  userTimezone,
}: {
  accounts: AccountsOverview[]
  userBaseCurrency?: string
  userTimezone?: string
}) {
  const { data: currencies = [] } = useCurrencies()
  const { data: plans = [], isLoading } = useTaxAdvantagedPlans()
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [search, setSearch] = useState('')
  const openCategory = plans.find((plan) => plan.id === openCategoryId) ?? null
  const currentYear = useMemo(() => currentYearForTimezone(userTimezone), [userTimezone])
  const linkedAccountCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const account of accounts) {
      if (!account.tax_advantaged_plan_id) continue
      counts.set(account.tax_advantaged_plan_id, (counts.get(account.tax_advantaged_plan_id) ?? 0) + 1)
    }
    return counts
  }, [accounts])
  const filteredPlans = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return plans
    return plans.filter((plan) =>
      plan.name.toLowerCase().includes(q)
      || plan.currency.toLowerCase().includes(q)
      || formatTaxTreatment(plan.tax_treatment).toLowerCase().includes(q),
    )
  }, [plans, search])

  const openCreateModal = () => {
    setCreateModalKey((key) => key + 1)
    setShowCreateModal(true)
  }

  return (
    <section id="tax-advantaged-categories" className="scroll-mt-8">
      <SectionHeader
        title="Tax-Advantaged Categories"
        description="Create category-level limits before assigning accounts to them."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
              <input
                className="app-input pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search categories..."
                disabled={plans.length === 0}
              />
            </div>
            <button
              type="button"
              className="app-primary-button shrink-0"
              onClick={openCreateModal}
            >
              <Plus size={16} aria-hidden />
              Create category
            </button>
          </div>

          {isLoading ? (
            <div className="h-24 rounded-lg bg-gray-300" />
          ) : plans.length === 0 ? (
            <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              No tax-advantaged categories yet.
            </p>
          ) : filteredPlans.length === 0 ? (
            <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              No categories match your search.
            </p>
          ) : (
            <TaxAdvantagedCategoriesTable
              currentYear={currentYear}
              linkedAccountCounts={linkedAccountCounts}
              onSelect={setOpenCategoryId}
              plans={filteredPlans}
            />
          )}
        </div>
      </SettingsCard>

      <AnimatePresence>
        {showCreateModal && (
          <CreateTaxAdvantagedCategoryModal
            key={createModalKey}
            currencies={currencies}
            onClose={() => setShowCreateModal(false)}
            userBaseCurrency={userBaseCurrency}
          />
        )}
        {openCategory && (
          <TaxAdvantagedCategoryModal
            key={openCategory.id}
            accounts={accounts}
            currencies={currencies}
            plan={openCategory}
            onClose={() => setOpenCategoryId(null)}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function TaxAdvantagedCategoriesTable({
  currentYear,
  linkedAccountCounts,
  onSelect,
  plans,
}: {
  currentYear: number
  linkedAccountCounts: Map<string, number>
  onSelect: (planId: string) => void
  plans: TaxAdvantagedPlan[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[660px] table-fixed text-left text-[0.9375rem]">
        <colgroup>
          <col />
          <col style={{ width: '10rem' }} />
          <col style={{ width: '12rem' }} />
          <col style={{ width: '7rem' }} />
        </colgroup>
        <thead>
          <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
            <th className="app-label px-4 py-3">Category</th>
            <th className="app-label py-3 pr-4">Current year</th>
            <th className="app-label py-3 pr-4">Limit years</th>
            <th className="app-label py-3 pr-4 text-right">Accounts</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan, index) => (
            <TaxAdvantagedCategoryRow
              key={plan.id}
              accountCount={linkedAccountCounts.get(plan.id) ?? 0}
              currentYear={currentYear}
              isLast={index === plans.length - 1}
              onSelect={onSelect}
              plan={plan}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TaxAdvantagedCategoryRow({
  accountCount,
  currentYear,
  isLast,
  onSelect,
  plan,
}: {
  accountCount: number
  currentYear: number
  isLast: boolean
  onSelect: (planId: string) => void
  plan: TaxAdvantagedPlan
}) {
  const { data: limits = [], isLoading } = useTaxAdvantagedPlanLimits(plan.id)
  const hasCurrentYearLimit = limits.some((limit) => limit.year === currentYear)
  const limitYearsLabel = formatLimitYears(limits.map((limit) => limit.year))

  return (
    <tr
      className="cursor-pointer transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--app-border)',
      }}
      tabIndex={0}
      onClick={() => onSelect(plan.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(plan.id)
        }
      }}
    >
      <td className="min-w-0 px-4 py-4">
        <span className="block truncate font-serif text-xl font-medium tracking-tight">{plan.name}</span>
        <span className="mt-0.5 block truncate text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {formatTaxTreatment(plan.tax_treatment)} · {plan.currency}
        </span>
      </td>
      <td className="py-4 pr-4 font-medium">
        {isLoading ? (
          <span style={{ color: 'var(--app-text-muted)' }}>Loading</span>
        ) : hasCurrentYearLimit ? (
          <span>{currentYear} configured</span>
        ) : (
          <span style={{ color: 'var(--app-negative)' }}>Missing {currentYear}</span>
        )}
      </td>
      <td className="py-4 pr-4">
        <span style={limitYearsLabel === 'None' ? { color: 'var(--app-text-muted)' } : undefined}>
          {isLoading ? 'Loading' : limitYearsLabel}
        </span>
      </td>
      <td className="py-4 pr-4 text-right">
        <span className="font-medium">{accountCount}</span>
        <span className="ml-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          linked
        </span>
      </td>
    </tr>
  )
}

function CreateTaxAdvantagedCategoryModal({
  currencies,
  onClose,
  userBaseCurrency,
}: {
  currencies: Currency[]
  onClose: () => void
  userBaseCurrency?: string
}) {
  const createPlan = useCreateTaxAdvantagedPlan()
  const [form, setForm] = useState<TaxPlanFormState>({
    name: '',
    tax_treatment: 'tax_free',
    currency: userBaseCurrency ?? '',
    lifetime_contribution_limit: '',
  })
  const [createError, setCreateError] = useState<string | null>(null)
  const selectedCurrency = form.currency || userBaseCurrency || ''
  const options = useMemo(() => currencyOptions(currencies), [currencies])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const setField = <K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setCreateError(null)
  }

  const handleCreatePlan = (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setCreateError('Name is required.')
      return
    }
    if (!selectedCurrency) {
      setCreateError('Currency is required.')
      return
    }
    if (!isValidMoneyInput(form.lifetime_contribution_limit)) {
      setCreateError('Lifetime limit must be zero or higher.')
      return
    }

    createPlan.mutate(
      {
        name: form.name.trim(),
        tax_treatment: form.tax_treatment,
        currency: selectedCurrency,
        lifetime_contribution_limit: toMinorUnits(form.lifetime_contribution_limit, currencies, selectedCurrency),
        group_id: null,
      },
      {
        onSuccess: onClose,
        onError: (error) => {
          setCreateError(error instanceof Error ? error.message : 'Failed to create category.')
        },
      },
    )
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-tax-advantaged-category-title"
          className="w-full max-w-2xl rounded-2xl p-6 sm:p-8"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <form className="space-y-6" onSubmit={handleCreatePlan}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="create-tax-advantaged-category-title" className="font-serif text-2xl font-light tracking-tight">
                  Create category
                </h3>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Define the shared limits before linking accounts.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="app-icon-button shrink-0"
                aria-label="Close"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Category name">
                <input
                  className="app-input"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="TFSA"
                  maxLength={256}
                  required
                />
              </Field>
              <Field label="Category type">
                <Dropdown
                  options={TAX_TREATMENT_OPTIONS}
                  value={form.tax_treatment}
                  onChange={(value) => setField('tax_treatment', value as TaxTreatment)}
                />
              </Field>
              <Field label="Currency">
                <Dropdown
                  options={options}
                  value={selectedCurrency}
                  onChange={(value) => setField('currency', value)}
                  placeholder="Select currency"
                  searchable
                  searchPlaceholder="Search currencies..."
                />
              </Field>
              <Field label="Lifetime contribution limit">
                <CurrencyInput
                  currencies={currencies}
                  currency={selectedCurrency}
                  value={form.lifetime_contribution_limit}
                  onChange={(value) => setField('lifetime_contribution_limit', value)}
                  placeholder="Optional"
                />
              </Field>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              {createError && (
                <p className="text-sm sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                  {createError}
                </p>
              )}
              <button
                type="button"
                className="app-secondary-button"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="app-primary-button inline-flex items-center justify-center gap-2"
                disabled={createPlan.isPending}
              >
                {createPlan.isPending ? <div className="app-spinner" aria-label="Creating" /> : <Plus size={16} aria-hidden />}
                Create category
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>
  )
}

function TaxAdvantagedCategoryModal({
  accounts,
  onClose,
  plan,
  currencies,
}: {
  accounts: AccountsOverview[]
  onClose: () => void
  plan: TaxAdvantagedPlan
  currencies: Currency[]
}) {
  const updatePlan = useUpdateTaxAdvantagedPlan(plan.id)
  const deletePlan = useDeleteTaxAdvantagedPlan()
  const updateAccount = useUpdateAccount()
  const { data: limits = [], isLoading: limitsLoading } = useTaxAdvantagedPlanLimits(plan.id)
  const createLimit = useCreateTaxAdvantagedPlanLimit()
  const updateLimit = useUpdateTaxAdvantagedPlanLimit()
  const deleteLimit = useDeleteTaxAdvantagedPlanLimit()
  const [activeTab, setActiveTab] = useState<CategoryModalTab>('limits')
  const [categoryEditOpen, setCategoryEditOpen] = useState(false)
  const [showAddTaxYear, setShowAddTaxYear] = useState(false)
  const [taxYearsExpanded, setTaxYearsExpanded] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [confirmingPlanDelete, setConfirmingPlanDelete] = useState(false)
  const planDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const planDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const planDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteButtonRef = useRef<HTMLButtonElement>(null)
  const limitDeleteIdleLabelRef = useRef<HTMLSpanElement>(null)
  const limitDeleteConfirmLabelRef = useRef<HTMLSpanElement>(null)
  const [planDeleteLabelWidths, setPlanDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const [limitDeleteLabelWidths, setLimitDeleteLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const planBase: TaxPlanFormState = {
    name: plan.name,
    tax_treatment: plan.tax_treatment,
    currency: plan.currency,
    lifetime_contribution_limit: fromMinorUnits(plan.lifetime_contribution_limit, currencies, plan.currency),
  }
  const [planOverrides, setPlanOverrides] = useState<Partial<TaxPlanFormState>>({})
  const planForm: TaxPlanFormState = { ...planBase, ...planOverrides }
  const [limitDrafts, setLimitDrafts] = useState<Record<number, Partial<Pick<TaxPlanLimitFormState, 'contribution_limit' | 'withdrawal_limit'>>>>({})
  const [newLimitForm, setNewLimitForm] = useState<TaxPlanLimitFormState>({
    year: String(DEFAULT_NEW_LIMIT_YEAR),
    contribution_limit: '',
    withdrawal_limit: '',
  })
  const [deleteConfirmYear, setDeleteConfirmYear] = useState<number | null>(null)
  const [pendingDeleteLimitYear, setPendingDeleteLimitYear] = useState<number | null>(null)
  const [pendingDeletedLimit, setPendingDeletedLimit] = useState<TaxAdvantagedPlanLimit | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [limitError, setLimitError] = useState<string | null>(null)
  const [planSaveStatus, setPlanSaveStatus] = useState<'idle' | 'loading' | 'success'>('idle')
  const [autosaveNotice, setAutosaveNotice] = useState<AutosaveNotice | null>(null)
  const autosaveTimerRef = useRef<number | null>(null)

  const showAutosaveNotice = (notice: AutosaveNotice) => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
    }
    setAutosaveNotice(notice)
    if (notice.status !== 'saving') {
      autosaveTimerRef.current = window.setTimeout(() => {
        setAutosaveNotice(null)
        autosaveTimerRef.current = null
      }, 2400)
    }
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  useEffect(() => () => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current)
    }
  }, [])

  useLayoutEffect(() => {
    if (planDeleteIdleLabelRef.current && planDeleteConfirmLabelRef.current) {
      setPlanDeleteLabelWidths({
        idle: planDeleteIdleLabelRef.current.offsetWidth,
        confirm: planDeleteConfirmLabelRef.current.offsetWidth,
      })
    }
    if (limitDeleteIdleLabelRef.current && limitDeleteConfirmLabelRef.current) {
      setLimitDeleteLabelWidths({
        idle: limitDeleteIdleLabelRef.current.offsetWidth,
        confirm: limitDeleteConfirmLabelRef.current.offsetWidth,
      })
    }
  }, [])

  useEffect(() => {
    if (!confirmingPlanDelete) return
    const onPointerDown = (event: PointerEvent) => {
      if (planDeleteButtonRef.current && !planDeleteButtonRef.current.contains(event.target as Node)) {
        setConfirmingPlanDelete(false)
      }
    }
    const timer = window.setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [confirmingPlanDelete])

  useEffect(() => {
    if (deleteConfirmYear === null || pendingDeleteLimitYear !== null) return
    const onPointerDown = (event: PointerEvent) => {
      if (limitDeleteButtonRef.current && !limitDeleteButtonRef.current.contains(event.target as Node)) {
        setDeleteConfirmYear(null)
      }
    }
    const timer = window.setTimeout(() => window.addEventListener('pointerdown', onPointerDown), 0)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [deleteConfirmYear, pendingDeleteLimitYear])

  const setPlanField = <K extends keyof TaxPlanFormState>(key: K, value: TaxPlanFormState[K]) => {
    setPlanOverrides((current) => ({ ...current, [key]: value }))
    setPlanError(null)
  }

  const setNewLimitField = <K extends keyof TaxPlanLimitFormState>(key: K, value: TaxPlanLimitFormState[K]) => {
    setNewLimitForm((current) => ({ ...current, [key]: value }))
    setLimitError(null)
  }

  const resetNewLimitForm = () => {
    setNewLimitForm({
      year: String(DEFAULT_NEW_LIMIT_YEAR),
      contribution_limit: '',
      withdrawal_limit: '',
    })
    setShowAddTaxYear(false)
    setLimitError(null)
  }

  const setLimitField = (
    year: number,
    key: keyof Pick<TaxPlanLimitFormState, 'contribution_limit' | 'withdrawal_limit'>,
    value: string,
  ) => {
    setLimitDrafts((current) => ({
      ...current,
      [year]: {
        ...current[year],
        [key]: value,
      },
    }))
    setLimitError(null)
    setDeleteConfirmYear(null)
  }

  const saveWhenFocusLeaves = (event: React.FocusEvent<HTMLElement>, save: () => void) => {
    const nextFocused = event.relatedTarget
    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) return
    save()
  }

  const getPlanUpdateState = (form: TaxPlanFormState) => {
    const nextLifetimeLimit = toMinorUnits(form.lifetime_contribution_limit, currencies, plan.currency)
    const dirty = form.name.trim() !== plan.name
      || form.tax_treatment !== plan.tax_treatment
      || nextLifetimeLimit !== plan.lifetime_contribution_limit
    return { dirty, nextLifetimeLimit }
  }

  const validatePlanForm = (form: TaxPlanFormState) => {
    if (!form.name.trim()) {
      return 'Name is required.'
    }
    if (!isValidMoneyInput(form.lifetime_contribution_limit)) {
      return 'Lifetime limit must be zero or higher.'
    }
    return null
  }

  const handleCategoryEditClick = async () => {
    if (updatePlan.isPending || planSaveStatus !== 'idle') return
    if (!categoryEditOpen) {
      setCategoryEditOpen(true)
      return
    }

    const validationError = validatePlanForm(planForm)
    if (validationError) {
      setPlanError(validationError)
      return
    }

    const { dirty, nextLifetimeLimit } = getPlanUpdateState(planForm)
    setPlanSaveStatus('loading')
    const minimumLoading = new Promise((resolve) => window.setTimeout(resolve, 1000))
    try {
      if (dirty) {
        await updatePlan.mutateAsync({
          name: planForm.name.trim(),
          tax_treatment: planForm.tax_treatment,
          lifetime_contribution_limit: nextLifetimeLimit,
        })
        setPlanOverrides({})
        setPlanError(null)
      }
      await minimumLoading
      setPlanSaveStatus('success')
      setCategoryEditOpen(false)
      await new Promise((resolve) => window.setTimeout(resolve, 1200))
      setPlanSaveStatus('idle')
    } catch (error) {
      await minimumLoading
      setPlanSaveStatus('idle')
      setPlanError(error instanceof Error ? error.message : 'Failed to update plan.')
    }
  }

  const handleDeletePlan = () => {
    deletePlan.mutate(plan.id, {
      onSuccess: onClose,
      onError: (error) => {
        setConfirmingPlanDelete(false)
        setPlanError(error instanceof Error ? error.message : 'Failed to delete plan.')
      },
    })
  }

  const sortedLimits = useMemo(() => {
    const nextLimits = [...limits]
    if (pendingDeletedLimit && !nextLimits.some((limit) => limit.year === pendingDeletedLimit.year)) {
      nextLimits.push(pendingDeletedLimit)
    }
    return nextLimits.sort((a, b) => b.year - a.year)
  }, [limits, pendingDeletedLimit])
  const visibleLimits = taxYearsExpanded ? sortedLimits : sortedLimits.slice(0, MAX_VISIBLE_LIMIT_ROWS)
  const hasHiddenLimitRows = sortedLimits.length > MAX_VISIBLE_LIMIT_ROWS
  const bindableAccounts = accounts.filter(
    (account) =>
      account.closed_at === null
      && account.account_kind === 'asset'
      && account.currency === plan.currency,
  )

  const limitDraft = (year: number) => {
    const limit = limits.find((row) => row.year === year)
      ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)
    return {
      contribution_limit: limitDrafts[year]?.contribution_limit
        ?? fromMinorUnits(limit?.contribution_limit ?? null, currencies, plan.currency),
      withdrawal_limit: limitDrafts[year]?.withdrawal_limit
        ?? fromMinorUnits(limit?.withdrawal_limit ?? null, currencies, plan.currency),
    }
  }

  const limitDirty = (year: number) => {
    const limit = limits.find((row) => row.year === year)
    if (!limit) return false
    const draft = limitDraft(year)
    return toMinorUnits(draft.contribution_limit, currencies, plan.currency) !== limit.contribution_limit
      || toMinorUnits(draft.withdrawal_limit, currencies, plan.currency) !== limit.withdrawal_limit
  }

  const handleSaveLimit = (year: number) => {
    if (!limitDirty(year) || updateLimit.isPending) return
    const draft = limitDraft(year)
    if (!isValidMoneyInput(draft.contribution_limit, true)) {
      setLimitError(`${year} contribution limit is required.`)
      showAutosaveNotice({ status: 'error', message: `${year} contribution limit is required.` })
      return
    }
    if (!isValidMoneyInput(draft.withdrawal_limit)) {
      setLimitError(`${year} withdrawal limit must be zero or higher.`)
      showAutosaveNotice({ status: 'error', message: `${year} withdrawal limit must be zero or higher.` })
      return
    }

    showAutosaveNotice({ status: 'saving', message: 'Saving limits...' })
    updateLimit.mutate(
      {
        planId: plan.id,
        year,
        contribution_limit: toMinorUnits(draft.contribution_limit, currencies, plan.currency) ?? 0,
        withdrawal_limit: toMinorUnits(draft.withdrawal_limit, currencies, plan.currency),
      },
      {
        onSuccess: () => {
          setLimitDrafts((current) => {
            const next = { ...current }
            delete next[year]
            return next
          })
          setLimitError(null)
          showAutosaveNotice({ status: 'saved', message: 'Limits saved.' })
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : `Failed to save ${year} limits.`
          setLimitError(message)
          showAutosaveNotice({ status: 'error', message })
        },
      },
    )
  }

  const handleCreateLimit = () => {
    if (!showAddTaxYear || createLimit.isPending) return
    const year = Number.parseInt(newLimitForm.year, 10)
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
      setLimitError('Year must be between 1900 and 2100.')
      showAutosaveNotice({ status: 'error', message: 'Year must be between 1900 and 2100.' })
      return
    }
    if (limits.some((limit) => limit.year === year)) {
      setLimitError(`A limit for ${year} already exists.`)
      showAutosaveNotice({ status: 'error', message: `A limit for ${year} already exists.` })
      return
    }
    if (!isValidMoneyInput(newLimitForm.contribution_limit, true)) {
      setLimitError('Contribution limit is required.')
      showAutosaveNotice({ status: 'error', message: 'Contribution limit is required.' })
      return
    }
    if (!isValidMoneyInput(newLimitForm.withdrawal_limit)) {
      setLimitError('Withdrawal limit must be zero or higher.')
      showAutosaveNotice({ status: 'error', message: 'Withdrawal limit must be zero or higher.' })
      return
    }

    showAutosaveNotice({ status: 'saving', message: 'Saving limits...' })
    createLimit.mutate(
      {
        planId: plan.id,
        year,
        contribution_limit: toMinorUnits(newLimitForm.contribution_limit, currencies, plan.currency) ?? 0,
        withdrawal_limit: toMinorUnits(newLimitForm.withdrawal_limit, currencies, plan.currency),
      },
      {
        onSuccess: () => {
          resetNewLimitForm()
          setTaxYearsExpanded(true)
          setLimitError(null)
          showAutosaveNotice({ status: 'saved', message: 'Limits saved.' })
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Failed to add tax-year limits.'
          setLimitError(message)
          showAutosaveNotice({ status: 'error', message })
        },
      },
    )
  }

  const handleDeleteLimit = async (limit: TaxAdvantagedPlanLimit) => {
    if (deleteConfirmYear !== limit.year) {
      setDeleteConfirmYear(limit.year)
      return
    }
    if (pendingDeleteLimitYear !== null) return

    setPendingDeleteLimitYear(limit.year)
    setPendingDeletedLimit(limit)
    const minimumFeedback = new Promise((resolve) => window.setTimeout(resolve, LIMIT_DELETE_FEEDBACK_MS))

    let deleteError: unknown = null
    try {
      await deleteLimit.mutateAsync({ planId: plan.id, year: limit.year })
    } catch (error) {
      deleteError = error
    }

    await minimumFeedback

    setPendingDeleteLimitYear(null)
    setPendingDeletedLimit(null)
    setDeleteConfirmYear(null)

    if (deleteError) {
      setLimitError(deleteError instanceof Error ? deleteError.message : 'Failed to delete limit.')
      return
    }

    setLimitError(null)
  }

  const handleToggleAccount = (account: AccountsOverview) => {
    const isLinked = account.tax_advantaged_plan_id === plan.id
    showAutosaveNotice({ status: 'saving', message: 'Saving account link...' })
    updateAccount.mutate(
      {
        accountId: account.id,
        payload: { tax_advantaged_plan_id: isLinked ? null : plan.id },
      },
      {
        onError: (error) => {
          const message = error instanceof Error ? error.message : 'Failed to update account binding.'
          setAccountError(message)
          showAutosaveNotice({ status: 'error', message })
        },
        onSuccess: () => {
          setAccountError(null)
          showAutosaveNotice({ status: 'saved', message: 'Account link saved.' })
        },
      },
    )
  }

  return (
    <>
      <AnimatePresence>
        {autosaveNotice && (
          <motion.div
            role={autosaveNotice.status === 'error' ? 'alert' : 'status'}
            aria-live={autosaveNotice.status === 'error' ? 'assertive' : 'polite'}
            className="fixed bottom-5 right-5 z-[70] flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium shadow-lg"
            style={{
              background: 'var(--app-bg)',
              border: '1px solid var(--app-border-strong)',
              color: autosaveNoticeColor(autosaveNotice.status),
            }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
          >
            <AutosaveStatusIcon status={autosaveNotice.status} />
            <span>{autosaveNotice.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tax-advantaged-category-title"
          className="w-full max-w-[64rem] max-h-[86vh] overflow-y-auto rounded-2xl lg:overflow-hidden"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="lg:grid lg:max-h-[86vh] lg:min-h-[580px] lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside
              className="flex min-w-0 flex-col gap-6 border-b p-6 sm:p-7 lg:min-h-0 lg:border-b-0 lg:border-r"
              style={{ background: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
            >
              <div className="h-10 min-w-0 overflow-hidden">
                <h3 id="tax-advantaged-category-title" className="h-10 font-serif text-3xl font-medium leading-10 tracking-tight">
                  <div className="relative h-10 min-w-0">
                    <motion.div
                      className={`absolute inset-0 group flex h-10 min-w-0 items-center gap-2 ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                      style={{ borderBottom: '1px solid var(--app-border-strong)' }}
                      animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={!categoryEditOpen}
                    >
                      <input
                        aria-label="Category name"
                        className="block h-10 min-w-0 flex-1 bg-transparent font-serif text-3xl font-medium leading-10 tracking-tight outline-none"
                        maxLength={256}
                        onChange={(event) => setPlanField('name', event.target.value)}
                        required
                        style={{ color: 'var(--app-text)' }}
                        tabIndex={categoryEditOpen ? undefined : -1}
                        value={planForm.name}
                      />
                      <Pencil
                        size={15}
                        className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                        style={{ color: 'var(--app-text-subtle)' }}
                        aria-hidden
                      />
                    </motion.div>
                    <motion.span
                      className={`absolute inset-0 block h-10 truncate leading-10 ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                      animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={categoryEditOpen}
                    >
                      {planForm.name.trim() || plan.name}
                    </motion.span>
                  </div>
                </h3>
              </div>

              <div className="space-y-4">
                <div className="relative h-14 min-w-0 overflow-hidden">
                  <p className={CATEGORY_SUMMARY_LABEL_CLASS}>Type</p>
                  <div className="relative h-6 min-w-0">
                    <motion.div
                      className={`absolute inset-0 ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                      animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={!categoryEditOpen}
                    >
                      <InlineTaxTreatmentSelect
                        value={planForm.tax_treatment}
                        onChange={(value) => setPlanField('tax_treatment', value)}
                      />
                    </motion.div>
                    <motion.p
                      className={`absolute inset-0 ${CATEGORY_SUMMARY_VALUE_CLASS} ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                      animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={categoryEditOpen}
                    >
                      {formatTaxTreatment(plan.tax_treatment)}
                    </motion.p>
                  </div>
                </div>

                <InfoItem label="Currency" value={plan.currency} />
                <InfoItem label="Scope" value={plan.group_id ? 'Group' : 'Personal'} />

                <div className="relative h-14 min-w-0 overflow-hidden">
                  <p className={CATEGORY_SUMMARY_LABEL_CLASS}>Lifetime limit</p>
                  <div className="relative h-6 min-w-0">
                    <motion.div
                      className={`absolute inset-0 ${categoryEditOpen ? '' : 'pointer-events-none'}`}
                      animate={{ opacity: categoryEditOpen ? 1 : 0 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={!categoryEditOpen}
                    >
                      <InlineCurrencyInput
                        ariaLabel="Lifetime contribution limit"
                        currencies={currencies}
                        currency={plan.currency}
                        value={planForm.lifetime_contribution_limit}
                        onChange={(value) => setPlanField('lifetime_contribution_limit', value)}
                        placeholder="Optional"
                      />
                    </motion.div>
                    <motion.p
                      className={`absolute inset-0 font-financial ${CATEGORY_SUMMARY_VALUE_CLASS} ${categoryEditOpen ? 'pointer-events-none' : ''}`}
                      animate={{ opacity: categoryEditOpen ? 0 : 1 }}
                      initial={false}
                      transition={CATEGORY_FIELD_TRANSITION}
                      aria-hidden={categoryEditOpen}
                    >
                      {plan.lifetime_contribution_limit === null ? 'Not set' : formatCurrency(plan.lifetime_contribution_limit, plan.currency)}
                    </motion.p>
                  </div>
                </div>
              </div>

              {planError && (
                <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                  {planError}
                </p>
              )}

              <div className="mt-auto flex items-center justify-between border-t pt-4" style={{ borderColor: 'var(--app-border)' }}>
                <ActionFeedbackButton
                  type="button"
                  className="app-secondary-button w-[72px]"
                  disabled={planSaveStatus !== 'idle'}
                  loadingLabel="Saving"
                  onClick={() => { void handleCategoryEditClick() }}
                  status={planSaveStatus}
                >
                  {categoryEditOpen ? 'Done' : 'Edit'}
                </ActionFeedbackButton>
                <button
                  ref={planDeleteButtonRef}
                  type="button"
                  className={`app-danger-button ${deletePlan.isPending && confirmingPlanDelete ? 'app-primary-button-loading' : ''}`}
                  onClick={() => {
                    if (deletePlan.isPending) return
                    if (confirmingPlanDelete) handleDeletePlan()
                    else setConfirmingPlanDelete(true)
                  }}
                  disabled={deletePlan.isPending}
                >
                  {deletePlan.isPending && confirmingPlanDelete ? (
                    <div className="app-spinner" />
                  ) : (
                    <span
                      className="relative block"
                      style={{
                        width: planDeleteLabelWidths
                          ? `${confirmingPlanDelete ? planDeleteLabelWidths.confirm : planDeleteLabelWidths.idle}px`
                          : 'auto',
                        height: '1.25rem',
                        transition: 'width 220ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                      }}
                    >
                      <span
                        ref={planDeleteIdleLabelRef}
                        className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                        aria-hidden
                      >
                        <Trash2 size={16} aria-hidden />
                        Delete
                      </span>
                      <span
                        ref={planDeleteConfirmLabelRef}
                        className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                        aria-hidden
                      >
                        <Check size={16} aria-hidden />
                        Yes, delete
                      </span>
                      <span
                        className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                        style={{ opacity: confirmingPlanDelete ? 0 : 1 }}
                      >
                        <Trash2 size={16} aria-hidden />
                        Delete
                      </span>
                      <span
                        className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity duration-150"
                        style={{ opacity: confirmingPlanDelete ? 1 : 0 }}
                      >
                        <Check size={16} aria-hidden />
                        Yes, delete
                      </span>
                    </span>
                  )}
                </button>
              </div>

            </aside>

            <div className="flex min-w-0 flex-col lg:min-h-0">
              <div
                className="flex items-stretch justify-between gap-3 border-b px-5 sm:px-6"
                style={{ borderColor: 'var(--app-border)' }}
              >
                <div
                  className="flex items-stretch gap-6"
                  role="tablist"
                  aria-label="Category settings"
                >
                  {([
                    ['limits', 'Limits'],
                    ['accounts', 'Accounts'],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === tab}
                      className="border-b-2 px-0 py-4 text-sm font-medium transition-colors duration-150"
                      onClick={() => setActiveTab(tab)}
                      style={{
                        color: activeTab === tab ? 'var(--app-text)' : 'var(--app-text-muted)',
                        borderColor: activeTab === tab ? 'var(--app-accent)' : 'transparent',
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="app-icon-button my-3 shrink-0"
                  aria-label="Close"
                >
                  <X size={18} aria-hidden />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
                {activeTab === 'limits' ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
                        Configure annual contribution and withdrawal limits.
                      </p>
                      <button
                        type="button"
                        className="app-secondary-button shrink-0"
                        onClick={() => setShowAddTaxYear(true)}
                        disabled={showAddTaxYear}
                      >
                        <Plus size={15} aria-hidden />
                        Add year
                      </button>
                    </div>

                    <div className="overflow-hidden">
                      <table className="w-full table-fixed text-left text-[0.9375rem]">
                        <colgroup>
                          <col style={{ width: '6.5rem' }} />
                          <col style={{ width: 'calc((100% - 11.5rem) / 2)' }} />
                          <col style={{ width: 'calc((100% - 11.5rem) / 2)' }} />
                          <col style={{ width: '5rem' }} />
                        </colgroup>
                        <thead>
                          <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
                            <th className="py-2 pr-4 font-medium">Year</th>
                            <th className="py-2 pl-0 pr-4 font-medium">Contribution limit</th>
                            <th className="py-2 pl-4 pr-0 font-medium">Withdrawal limit</th>
                            <th className="py-2 pl-2 font-medium" aria-label="Actions" />
                          </tr>
                        </thead>
                        <tbody>
                          {showAddTaxYear && (
                            <tr
                              style={{ borderBottom: '1px solid var(--app-border)' }}
                              onBlur={(event) => saveWhenFocusLeaves(event, handleCreateLimit)}
                            >
                              <td className="min-w-0 py-3 pr-5">
                                <div
                                  className="group flex h-9 w-20 items-center gap-1.5 rounded-md border border-transparent px-2 transition-colors duration-150 hover:border-[var(--app-border)] focus-within:border-[var(--app-accent-border)]"
                                  style={{ background: 'color-mix(in srgb, var(--app-input-bg) 55%, var(--app-bg))' }}
                                >
                                  <input
                                    aria-label="New tax year"
                                    className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    type="text"
                                    value={newLimitForm.year}
                                    onChange={(event) => setNewLimitField('year', event.target.value.replace(/\D/g, '').slice(0, 4))}
                                    style={{ color: 'var(--app-text)' }}
                                  />
                                  <Pencil
                                    size={13}
                                    className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                                    style={{ color: 'var(--app-text-subtle)' }}
                                    aria-hidden
                                  />
                                </div>
                              </td>
                              <td className="min-w-0 py-3 pl-0 pr-4">
                                <CompactCurrencyInput
                                  ariaLabel="New tax-year contribution limit"
                                  currencies={currencies}
                                  currency={plan.currency}
                                  value={newLimitForm.contribution_limit}
                                  onChange={(value) => setNewLimitField('contribution_limit', value)}
                                  placeholder="Contribution limit"
                                />
                              </td>
                              <td className="min-w-0 py-3 pl-4 pr-0">
                                <CompactCurrencyInput
                                  ariaLabel="New tax-year withdrawal limit"
                                  currencies={currencies}
                                  currency={plan.currency}
                                  value={newLimitForm.withdrawal_limit}
                                  onChange={(value) => setNewLimitField('withdrawal_limit', value)}
                                  placeholder="Optional"
                                />
                              </td>
                              <td className="py-3 pl-2">
                                <div className="flex items-center justify-center gap-1">
                                  <button
                                    type="button"
                                    className="app-icon-button shrink-0"
                                    onClick={handleCreateLimit}
                                    disabled={createLimit.isPending}
                                    aria-label="Save new tax year"
                                  >
                                    {createLimit.isPending ? (
                                      <LoaderCircle size={14} className="animate-spin" aria-hidden />
                                    ) : (
                                      <Check size={14} aria-hidden />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="app-icon-button shrink-0"
                                    onClick={resetNewLimitForm}
                                    disabled={createLimit.isPending}
                                    aria-label="Cancel new tax year"
                                  >
                                    <X size={14} aria-hidden />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {limitsLoading ? (
                            <tr>
                              <td className="py-3" colSpan={4}>
                                <div className="h-10 rounded-lg bg-gray-300" />
                              </td>
                            </tr>
                          ) : sortedLimits.length === 0 && !showAddTaxYear ? (
                            <tr>
                              <td className="py-4 text-sm italic" colSpan={4} style={{ color: 'var(--app-text-subtle)' }}>
                                No limit entries yet.
                              </td>
                            </tr>
                          ) : (
                            visibleLimits.map((limit) => {
                              const draft = limitDraft(limit.year)
                              const confirmingDelete = deleteConfirmYear === limit.year
                              const deletingLimit = pendingDeleteLimitYear === limit.year
                              return (
                                <tr key={limit.year} style={{ borderBottom: '1px solid var(--app-border)' }}>
                                  <td className="py-3 pr-4 font-medium">{limit.year}</td>
                                  <td className="min-w-0 py-3 pl-0 pr-4">
                                    <CompactCurrencyInput
                                      ariaLabel={`${limit.year} contribution limit`}
                                      currencies={currencies}
                                      currency={plan.currency}
                                      onBlur={() => handleSaveLimit(limit.year)}
                                      value={draft.contribution_limit}
                                      onChange={(value) => setLimitField(limit.year, 'contribution_limit', value)}
                                    />
                                  </td>
                                  <td className="min-w-0 py-3 pl-4 pr-0">
                                    <CompactCurrencyInput
                                      ariaLabel={`${limit.year} withdrawal limit`}
                                      currencies={currencies}
                                      currency={plan.currency}
                                      onBlur={() => handleSaveLimit(limit.year)}
                                      value={draft.withdrawal_limit}
                                      onChange={(value) => setLimitField(limit.year, 'withdrawal_limit', value)}
                                      placeholder="Optional"
                                    />
                                  </td>
                                  <td className="py-3 pl-2">
                                    <div className="flex items-center justify-center">
                                      <button
                                        ref={confirmingDelete ? limitDeleteButtonRef : undefined}
                                        type="button"
                                        className="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors duration-150 hover:bg-[var(--app-negative-soft)]"
                                        onClick={() => { void handleDeleteLimit(limit) }}
                                        disabled={pendingDeleteLimitYear !== null}
                                        style={{ color: confirmingDelete || deletingLimit ? 'var(--app-negative)' : 'var(--app-text-subtle)' }}
                                        aria-label={confirmingDelete ? `Confirm deleting ${limit.year} limits` : `Delete ${limit.year} limits`}
                                      >
                                        <span
                                          className="relative block"
                                          style={{
                                            width: limitDeleteLabelWidths
                                              ? `${confirmingDelete || deletingLimit ? limitDeleteLabelWidths.confirm : limitDeleteLabelWidths.idle}px`
                                              : 'auto',
                                            height: '1rem',
                                            transition: 'width 150ms ease-out',
                                          }}
                                        >
                                          <span
                                            ref={limitDeleteIdleLabelRef}
                                            className="invisible absolute inline-flex items-center whitespace-nowrap"
                                            aria-hidden
                                          >
                                            <Trash2 size={14} aria-hidden />
                                          </span>
                                          <span
                                            ref={limitDeleteConfirmLabelRef}
                                            className="invisible absolute inline-flex items-center whitespace-nowrap"
                                            aria-hidden
                                          >
                                            Confirm
                                          </span>
                                          <motion.span
                                            className="absolute inset-0 inline-flex items-center justify-center"
                                            animate={{ opacity: deletingLimit ? 1 : 0 }}
                                            initial={false}
                                            transition={LIMIT_DELETE_BUTTON_TRANSITION}
                                            aria-hidden={!deletingLimit}
                                          >
                                            <LoaderCircle size={14} className="animate-spin" aria-hidden />
                                          </motion.span>
                                          <motion.span
                                            className="absolute inset-0 inline-flex items-center justify-center"
                                            animate={{ opacity: confirmingDelete && !deletingLimit ? 1 : 0 }}
                                            initial={false}
                                            transition={LIMIT_DELETE_BUTTON_TRANSITION}
                                            aria-hidden={!confirmingDelete || deletingLimit}
                                          >
                                            Confirm
                                          </motion.span>
                                          <motion.span
                                            className="absolute inset-0 inline-flex items-center justify-center"
                                            animate={{ opacity: confirmingDelete || deletingLimit ? 0 : 1 }}
                                            initial={false}
                                            transition={LIMIT_DELETE_BUTTON_TRANSITION}
                                            aria-hidden={confirmingDelete || deletingLimit}
                                          >
                                            <Trash2 size={14} aria-hidden />
                                          </motion.span>
                                        </span>
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    {hasHiddenLimitRows && !limitsLoading && (
                      <div className="flex justify-center">
                        <button
                          type="button"
                          className="app-secondary-button"
                          onClick={() => setTaxYearsExpanded((current) => !current)}
                        >
                          {taxYearsExpanded ? 'See less' : 'See more'}
                        </button>
                      </div>
                    )}
                    {limitError && (
                      <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                        {limitError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
                        Choose eligible {plan.currency} accounts for this category.
                      </p>
                      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                        {bindableAccounts.filter((account) => account.tax_advantaged_plan_id === plan.id).length} of {bindableAccounts.length} linked
                      </p>
                    </div>

                    {accountError && (
                      <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                        {accountError}
                      </p>
                    )}

                    {bindableAccounts.length === 0 ? (
                      <p className="py-3 text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
                        No eligible {plan.currency} asset accounts.
                      </p>
                    ) : (
                      <div
                        className="overflow-hidden rounded-xl border"
                        style={{ borderColor: 'var(--app-border)' }}
                      >
                        {bindableAccounts.map((account, index) => {
                          const linked = account.tax_advantaged_plan_id === plan.id
                          const linkedElsewhere = account.tax_advantaged_plan_id !== null && !linked
                          const pending = updateAccount.isPending && updateAccount.variables?.accountId === account.id
                          return (
                            <label
                              key={account.id}
                              className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
                              style={{
                                borderTop: index === 0 ? 'none' : '1px solid var(--app-border)',
                                opacity: linkedElsewhere ? 0.55 : 1,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={linked}
                                onChange={() => handleToggleAccount(account)}
                                disabled={linkedElsewhere || pending}
                                aria-label={`${linked ? 'Unlink' : 'Link'} ${account.name}`}
                                className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                                style={{ accentColor: 'var(--app-accent)' }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-medium">{account.name}</span>
                                <span className="block truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
                                  {account.institution?.name ?? 'Cash'}
                                  {linkedElsewhere ? ' · Linked elsewhere' : ''}
                                </span>
                              </span>
                              <span className="font-financial text-sm">
                                {formatCurrency(account.current_balance, account.currency)}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}

function InfoItem({
  financial = false,
  label,
  value,
}: {
  financial?: boolean
  label: string
  value: string
}) {
  return (
    <div className="h-14 min-w-0 overflow-hidden">
      <p className={CATEGORY_SUMMARY_LABEL_CLASS}>{label}</p>
      <p className={`${financial ? 'font-financial' : ''} ${CATEGORY_SUMMARY_VALUE_CLASS}`}>
        {value}
      </p>
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
