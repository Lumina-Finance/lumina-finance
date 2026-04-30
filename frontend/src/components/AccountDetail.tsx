import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, EyeOff, Pencil, Plus, Search, Trash2, TrendingDown, TrendingUp, X, ArrowLeft } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  useAccount,
  useAccountCashFlow,
  useAccountSnapshots,
  useAccountSpendingBreakdown,
  useDeleteAccount,
  useUpdateAccount,
  type Account,
  type AccountBalanceSnapshot,
  type AccountMonthlyCashFlow,
  type AccountSpendingBreakdown,
  type SnapshotGranularity,
  type SpendingRange,
} from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useCurrencies, type Currency } from '@/api/currency'
import { useInstitutions } from '@/api/institutions'
import { useMerchants } from '@/api/merchants'
import {
  useInfiniteTransactions,
  type Transaction,
} from '@/api/transactions'
import { useTaxAdvantagedPlan, useTaxAdvantagedPlans, type TaxAdvantagedPlan } from '@/api/taxAdvantagedPlans'
import { formatCurrency } from '@/utils/formatCurrency'
import CreateTransactionModal from '@/components/CreateTransactionModal'
import Dropdown from '@/components/Dropdown'
import FilterChip from '@/components/FilterChip'
import FilterOptionList from '@/components/FilterOptionList'

const DEFAULT_CATEGORY_ICON = '🏷️'

const ACCOUNT_KIND_LABEL: Record<string, string> = {
  asset: 'Asset',
  revolving: 'Revolving credit',
  amortizing: 'Amortizing debt',
}

function humanizeAccountType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function currencyExponent(currencies: Currency[], code: string): number {
  return currencies.find((currency) => currency.id === code)?.minor_unit_exponent ?? 2
}

function fromMinorUnits(value: number | null, currencies: Currency[], code: string): string {
  if (value === null) return ''
  const exponent = currencyExponent(currencies, code)
  const major = value / Math.pow(10, exponent)
  return exponent === 0 ? String(Math.round(major)) : Number(major.toFixed(exponent)).toString()
}

function toMinorUnits(value: string, currencies: Currency[], code: string): number | null {
  if (!value.trim()) return null
  const exponent = currencyExponent(currencies, code)
  return Math.round(Number(value) * Math.pow(10, exponent))
}

function isValidMoneyInput(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) && parsed >= 0
}

// Balance chart range presets. Each range drives a lookback window + a
// backend bucketing granularity so payloads stay bounded — daily for 7D,
// weekly for 30D/90D, monthly for 1Y.
type BalanceRange = '7D' | '30D' | '90D' | '1Y'
const BALANCE_RANGES: BalanceRange[] = ['7D', '30D', '90D', '1Y']
const RANGE_CONFIG: Record<
  BalanceRange,
  { days: number; granularity: SnapshotGranularity }
> = {
  '7D': { days: 7, granularity: 'day' },
  '30D': { days: 30, granularity: 'day' },
  '90D': { days: 90, granularity: 'week' },
  '1Y': { days: 365, granularity: 'month' },
}

// Shared across the balance tooltip so hover position slides instead of snaps.
const TOOLTIP_WRAPPER_STYLE = {
  transition: 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 150ms ease-out',
  pointerEvents: 'none' as const,
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Round a date down to the start of the bucket it falls in. Day buckets have
// no rounding; week buckets snap to Monday (ISO); month/quarter snap to the
// 1st of the bucket's calendar period.
function bucketStart(d: Date, granularity: SnapshotGranularity): Date {
  if (granularity === 'day') {
    const c = new Date(d)
    c.setHours(0, 0, 0, 0)
    return c
  }
  if (granularity === 'week') {
    const c = new Date(d)
    c.setHours(0, 0, 0, 0)
    const day = c.getDay() // 0=Sunday
    const toMonday = day === 0 ? -6 : 1 - day
    c.setDate(c.getDate() + toMonday)
    return c
  }
  if (granularity === 'month') {
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }
  // quarter
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1)
}

// Advance `d` to the start of the next bucket.
function advanceBucket(d: Date, granularity: SnapshotGranularity): Date {
  const c = new Date(d)
  if (granularity === 'day') c.setDate(c.getDate() + 1)
  else if (granularity === 'week') c.setDate(c.getDate() + 7)
  else if (granularity === 'month') c.setMonth(c.getMonth() + 1)
  else c.setMonth(c.getMonth() + 3)
  return c
}

// Generate per-bucket samples. Each bucket contributes one chart point: the
// X-axis position sits at the bucket's START (e.g., Jan 1 for January), while
// the balance is read at the bucket's END (Jan 31). For the current bucket
// (not yet closed), end is clipped to today so the latest data reflects.
function generateBuckets(
  fromDate: Date,
  today: Date,
  granularity: SnapshotGranularity,
): { labelDate: Date; valueDate: Date }[] {
  const buckets: { labelDate: Date; valueDate: Date }[] = []
  let cursor = bucketStart(fromDate, granularity)
  while (cursor <= today) {
    const nextStart = advanceBucket(cursor, granularity)
    const bucketEnd = new Date(nextStart)
    bucketEnd.setDate(bucketEnd.getDate() - 1) // inclusive last day of bucket
    const valueDate = bucketEnd > today ? today : bucketEnd
    buckets.push({ labelDate: new Date(cursor), valueDate })
    cursor = nextStart
  }
  return buckets
}

// Build the chart series: one point per bucket. Balance comes from the latest
// snapshot at or before the bucket's end. Buckets with no preceding data
// render at 0. Each point also carries a `tooltipLabel` that names the exact
// date the balance is read at (e.g. "Jan 31, 2026") — useful because the
// axis label sits at the bucket start ("Jan") which would otherwise be
// ambiguous on hover.
function buildChartSeries(
  snapshots: AccountBalanceSnapshot[],
  fromDate: Date,
  granularity: SnapshotGranularity,
): { date: string; dateLabel: string; tooltipLabel: string; balance: number }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const buckets = generateBuckets(fromDate, today, granularity)
  if (buckets.length === 0) return []

  const sorted = [...snapshots].sort((a, b) => a.dt.localeCompare(b.dt))

  // Pointer walks through sorted snapshots as bucket-end dates advance.
  // Buckets before the first snapshot render at 0 (no data yet).
  let idx = 0
  let runningBalance = 0
  const points: { date: string; dateLabel: string; tooltipLabel: string; balance: number }[] = []
  for (const bucket of buckets) {
    const valueDateStr = toISODate(bucket.valueDate)
    while (idx < sorted.length && sorted[idx].dt <= valueDateStr) {
      runningBalance = sorted[idx].balance
      idx++
    }
    points.push({
      date: toISODate(bucket.labelDate),
      dateLabel: bucket.labelDate.toLocaleDateString('en-US', {
        month: 'short',
        day: granularity === 'month' ? undefined : 'numeric',
      }),
      tooltipLabel: bucket.valueDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
      balance: runningBalance,
    })
  }

  return points
}

// Larger version of the accounts-list logo — 64px square so the detail card
// reads as "this one account" rather than a row in a list.
function DetailInstitutionLogo({ institution }: { institution: Account['institution'] }) {
  const faviconUrl = institution?.website
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(institution.website)}&size=256`
    : null
  return (
    <div
      className="w-14 h-14 shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
      style={
        faviconUrl
          ? undefined
          : {
              background: 'var(--app-accent-soft)',
              border: '1px solid var(--app-border)',
            }
      }
    >
      {faviconUrl ? (
        <img
          src={faviconUrl}
          alt={`${institution!.name} logo`}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      ) : (
        <span className="text-xl font-semibold select-none" style={{ color: 'var(--app-accent)' }}>$</span>
      )}
    </div>
  )
}

function taxAdvantagedUsageColor(used: number, limit: number): string {
  if (limit <= 0) return used > 0 ? 'var(--app-negative)' : 'var(--app-text-subtle)'
  const ratio = used / limit
  if (ratio > 1) return 'var(--app-negative)'
  if (ratio >= 0.85) return 'var(--app-accent)'
  return 'var(--app-positive)'
}

function taxAdvantagedUsagePercent(used: number, limit: number): number {
  if (limit <= 0) return used > 0 ? 100 : 0
  return Math.min(Math.max((used / limit) * 100, 0), 100)
}

function DetailLimitUsage({
  label,
  used,
  limit,
  currency,
}: {
  label: string
  used: number
  limit: number | null
  currency: string
}) {
  if (limit === null) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {label}
          </p>
          <p className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
            N/A
          </p>
        </div>
      </div>
    )
  }

  const color = taxAdvantagedUsageColor(used, limit)
  const usageLabel = `${formatCurrency(used, currency)} / ${formatCurrency(limit, currency)}`
  const usagePercent = taxAdvantagedUsagePercent(used, limit)

  return (
    <div className="group relative">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          {label}
        </p>
        <p className="font-financial text-sm font-semibold tabular-nums" style={{ color }}>
          {Math.round(usagePercent)}%
        </p>
      </div>
      <div className="relative mt-1">
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: 'var(--app-border)' }}
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={Math.max(limit, 0)}
          aria-valuenow={Math.min(Math.max(used, 0), Math.max(limit, 0))}
          aria-valuetext={usageLabel}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: color,
              width: `${usagePercent}%`,
            }}
          />
        </div>
        <div
          className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            color: 'var(--app-text)',
          }}
        >
          {usageLabel}
        </div>
      </div>
    </div>
  )
}

function TaxAdvantagedCategoryBand({
  plan,
  hasError,
}: {
  plan: TaxAdvantagedPlan | undefined
  hasError: boolean
}) {
  return (
    <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--app-border)' }}>
      {hasError || !plan ? (
        <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          Linked category unavailable
        </p>
      ) : (
        <>
          <div className="min-w-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{plan.name}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Across linked accounts
              </p>
            </div>
          </div>

          {plan.current_year_contribution_limit === null &&
          plan.current_year_withdrawal_limit === null ? (
            <p className="mt-3 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              No current-year limits set
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <DetailLimitUsage
                label="Contribution limit"
                used={plan.ytd_contributions}
                limit={plan.current_year_contribution_limit}
                currency={plan.currency}
              />
              <DetailLimitUsage
                label="Withdrawal limit"
                used={plan.ytd_withdrawals}
                limit={plan.current_year_withdrawal_limit}
                currency={plan.currency}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StandardAccountBand() {
  return (
    <div className="mt-auto pt-4" style={{ borderTop: '1px solid var(--app-border)' }}>
      <p className="text-sm font-semibold">Standard account</p>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
        No contribution or withdrawal limits
      </p>
    </div>
  )
}

interface AccountIdentityForm {
  name: string
  institution_id: string
  tax_advantaged_plan_id: string
  credit_limit: string
  is_hidden: boolean
}

type DeleteAccountStage = 'idle' | 'confirm' | 'type-name'
const MIN_DELETE_SPINNER_MS = 1000

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function EditAccountIdentityModal({
  account,
  onClose,
}: {
  account: Account
  onClose: () => void
}) {
  const navigate = useNavigate()
  const updateAccount = useUpdateAccount()
  const deleteAccount = useDeleteAccount()
  const { data: currencies = [] } = useCurrencies()
  const { data: institutions = [] } = useInstitutions()
  const { data: taxAdvantagedPlans = [] } = useTaxAdvantagedPlans()
  const [form, setForm] = useState<AccountIdentityForm>({
    name: account.name,
    institution_id: account.institution?.id ?? '',
    tax_advantaged_plan_id: account.tax_advantaged_plan_id ?? '',
    credit_limit: fromMinorUnits(account.credit_limit, currencies, account.currency),
    is_hidden: account.is_hidden,
  })
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof AccountIdentityForm, string>>>({})
  const [deleteStage, setDeleteStage] = useState<DeleteAccountStage>('idle')
  const [deleteNameInput, setDeleteNameInput] = useState('')
  const [deleteDelayPending, setDeleteDelayPending] = useState(false)

  const isRevolving = account.account_kind === 'revolving'
  const canLinkTaxAdvantagedCategory = account.account_kind === 'asset' && account.group_id === null

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

  const institutionOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...institutions.map((institution) => ({ value: institution.id, label: institution.name })),
    ],
    [institutions],
  )

  const taxAdvantagedCategoryOptions = useMemo(
    () => [
      { value: '', label: 'None' },
      ...taxAdvantagedPlans
        .filter((plan) => plan.group_id === null && plan.currency === account.currency)
        .map((plan) => ({ value: plan.id, label: plan.name })),
    ],
    [account.currency, taxAdvantagedPlans],
  )

  const setField = <K extends keyof AccountIdentityForm>(field: K, value: AccountIdentityForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError(null)
  }

  const validate = () => {
    const errors: Partial<Record<keyof AccountIdentityForm, string>> = {}
    if (!form.name.trim()) errors.name = 'Name is required.'
    else if (form.name.trim().length > 256) errors.name = 'Name must be 256 characters or less.'
    if (isRevolving && !isValidMoneyInput(form.credit_limit)) {
      errors.credit_limit = 'Credit limit must be zero or higher.'
    }
    return errors
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isBusy || deleteStage !== 'idle') return
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    updateAccount.mutate(
      {
        accountId: account.id,
        payload: {
          name: form.name.trim(),
          institution_id: form.institution_id || null,
          is_hidden: form.is_hidden,
          ...(isRevolving
            ? { credit_limit: toMinorUnits(form.credit_limit, currencies, account.currency) }
            : {}),
          ...(canLinkTaxAdvantagedCategory
            ? { tax_advantaged_plan_id: form.tax_advantaged_plan_id || null }
            : {}),
        },
      },
      {
        onSuccess: onClose,
        onError: (error) => {
          setSubmitError(error instanceof Error ? error.message : 'Failed to update account.')
        },
      },
    )
  }

  const handleHideAccount = () => {
    setDeleteError(null)
    updateAccount.mutate(
      {
        accountId: account.id,
        payload: { is_hidden: true },
      },
      {
        onSuccess: onClose,
        onError: (error) => {
          setDeleteError(error instanceof Error ? error.message : 'Failed to hide account.')
        },
      },
    )
  }

  const handleDeleteAccount = async () => {
    if (deleteNameInput !== account.name || isBusy) return
    setDeleteError(null)
    setDeleteDelayPending(true)
    const minimumDelay = wait(MIN_DELETE_SPINNER_MS)

    try {
      await deleteAccount.mutateAsync(account.id)
      await minimumDelay
      onClose()
      navigate('/accounts', { replace: true })
    } catch (error) {
      await minimumDelay
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete account.')
      setDeleteDelayPending(false)
    }
  }

  const deleteLoading = deleteAccount.isPending || deleteDelayPending
  const isBusy = updateAccount.isPending || deleteLoading
  const canDelete = deleteNameInput === account.name

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-account-identity-title"
          className="w-full max-w-lg rounded-2xl p-8"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="mb-8 flex items-center justify-between gap-4">
            <h2 id="edit-account-identity-title" className="font-serif text-3xl font-light tracking-tight">
              Edit Account
            </h2>
            <button type="button" className="app-icon-button shrink-0" onClick={onClose} aria-label="Close">
              <X size={20} aria-hidden />
            </button>
          </div>

          <div className="space-y-5">
            <div>
              <label htmlFor="edit-account-name" className="app-label mb-1.5 block">
                Account Name
              </label>
              <input
                id="edit-account-name"
                className={`app-input ${fieldErrors.name ? 'app-input-error' : ''}`}
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                maxLength={256}
              />
              {fieldErrors.name && (
                <p className="mt-1 text-xs" style={{ color: 'var(--app-negative)' }}>
                  {fieldErrors.name}
                </p>
              )}
            </div>

            <div>
              <label className="app-label mb-1.5 block">Institution</label>
              <Dropdown
                options={institutionOptions}
                value={form.institution_id}
                onChange={(value) => setField('institution_id', value)}
                placeholder="Select institution..."
                searchable
                searchPlaceholder="Search institutions..."
              />
            </div>

            {canLinkTaxAdvantagedCategory && (
              <div>
                <label className="app-label mb-1.5 block">Tax-Advantaged Category</label>
                <Dropdown
                  options={taxAdvantagedCategoryOptions}
                  value={form.tax_advantaged_plan_id}
                  onChange={(value) => setField('tax_advantaged_plan_id', value)}
                  placeholder="Select category..."
                  searchable
                  searchPlaceholder="Search categories..."
                />
              </div>
            )}

            {isRevolving && (
              <div>
                <label htmlFor="edit-credit-limit" className="app-label mb-1.5 block">
                  Credit Limit
                </label>
                <input
                  id="edit-credit-limit"
                  className={`app-input ${fieldErrors.credit_limit ? 'app-input-error' : ''}`}
                  inputMode="decimal"
                  value={form.credit_limit}
                  onChange={(event) => setField('credit_limit', event.target.value)}
                  placeholder="Optional"
                />
                {fieldErrors.credit_limit && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--app-negative)' }}>
                    {fieldErrors.credit_limit}
                  </p>
                )}
              </div>
            )}

            <label
              htmlFor="edit-account-hidden"
              className="flex cursor-pointer items-center justify-between gap-4 rounded-xl p-4"
              style={{
                background: 'var(--app-input-bg)',
                border: '1px solid var(--app-input-border)',
              }}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">
                  <EyeOff size={16} style={{ color: 'var(--app-text-muted)' }} aria-hidden />
                  Hide account
                </span>
                <span className="mt-0.5 block text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Exclude this account from overview totals and primary lists.
                </span>
              </span>
              <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors">
                <input
                  id="edit-account-hidden"
                  type="checkbox"
                  role="switch"
                  checked={form.is_hidden}
                  onChange={(event) => setField('is_hidden', event.target.checked)}
                  className="peer sr-only"
                />
                <span
                  className="absolute inset-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
                  style={{ background: form.is_hidden ? 'var(--app-accent)' : 'var(--app-border-strong)' }}
                  aria-hidden
                />
                <span
                  className="relative h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                  style={{ transform: form.is_hidden ? 'translateX(1.25rem)' : 'translateX(0)' }}
                  aria-hidden
                />
              </span>
            </label>

            {submitError && (
              <p className="text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
                {submitError}
              </p>
            )}

            {deleteStage !== 'idle' && (
              <div className="pt-2">
                <div
                  className="rounded-xl p-4"
                  style={{
                    background: 'var(--app-negative-soft)',
                    border: '1px solid var(--app-negative-border)',
                  }}
                >
                  <div className="flex gap-3">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{
                        background: 'var(--app-bg)',
                        color: 'var(--app-negative)',
                      }}
                    >
                      <AlertTriangle size={16} aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="app-label break-words font-semibold">
                        Delete {account.name}?
                      </p>
                      <p className="mt-1 text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
                        Permanent deletion removes its transactions, budgets, and balance history. Hide it instead
                        if you only want it out of view.
                      </p>

                      {deleteStage === 'confirm' && (
                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          {!account.is_hidden ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 text-sm font-medium"
                              style={{ color: 'var(--app-text-muted)' }}
                              onClick={handleHideAccount}
                              disabled={isBusy}
                            >
                              {updateAccount.isPending ? (
                                <span className="app-spinner" />
                              ) : (
                                <>
                                  <EyeOff size={15} aria-hidden />
                                  Hide instead
                                </>
                              )}
                            </button>
                          ) : (
                            <span aria-hidden />
                          )}
                          <button
                            type="button"
                            className="app-danger-button justify-center sm:ml-auto"
                            onClick={() => setDeleteStage('type-name')}
                            disabled={isBusy}
                          >
                            Continue
                          </button>
                        </div>
                      )}

                      {deleteStage === 'type-name' && (
                        <div className="mt-4">
                          <label
                            htmlFor="delete-account-name"
                            className="mb-1.5 block break-words text-[0.9375rem]"
                            style={{ color: 'var(--app-text-muted)' }}
                          >
                            Type "{account.name}" to delete.
                          </label>
                          <input
                            id="delete-account-name"
                            className="app-input"
                            value={deleteNameInput}
                            onChange={(event) => {
                              setDeleteNameInput(event.target.value)
                              setDeleteError(null)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter') return
                              event.preventDefault()
                              handleDeleteAccount()
                            }}
                            disabled={isBusy}
                            autoComplete="off"
                          />
                        </div>
                      )}

                      {deleteError && (
                        <p className="mt-3 text-[0.9375rem] font-medium" style={{ color: 'var(--app-negative)' }}>
                          {deleteError}
                        </p>
                      )}

                      {deleteStage === 'type-name' && (
                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            className={`app-danger-button ${deleteLoading ? 'app-primary-button-loading' : ''}`}
                            onClick={handleDeleteAccount}
                            disabled={!canDelete || isBusy}
                          >
                            {deleteLoading ? <span className="app-spinner" /> : 'Delete account'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div
            className="mt-8 flex items-center gap-3 pt-4"
            style={{ borderTop: '1px solid var(--app-border)' }}
          >
            <button
              type="button"
              className="app-danger-button h-10 w-10 shrink-0 px-0"
              onClick={() => setDeleteStage('confirm')}
              disabled={isBusy || deleteStage !== 'idle'}
              aria-label="Delete account"
              title="Delete account"
            >
              <Trash2 size={16} aria-hidden />
            </button>
            <div className="ml-auto flex items-center gap-3">
              <button
                type="button"
                className="app-secondary-button"
                onClick={onClose}
                disabled={isBusy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`app-primary-button ${updateAccount.isPending && deleteStage === 'idle' ? 'app-primary-button-loading' : ''}`}
                disabled={isBusy || deleteStage !== 'idle'}
              >
                {updateAccount.isPending && deleteStage === 'idle' ? <span className="app-spinner" /> : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  )
}

// Warm-earth palette matching the dashboard spending breakdown so swatches
// feel consistent across the app.
const CATEGORY_COLORS = [
  '#C9A96A', '#6CA07B', '#D4906A', '#9B8FC8', '#C97982', '#7AAEC8', '#8C8074',
]

// Spending range tabs. `SpendingRange` is imported from the API layer so
// the select options stay in lockstep with the backend's accepted values.
const SPENDING_RANGES: SpendingRange[] = ['WTD', 'MTD', 'QTD', 'YTD']

interface BreakdownRow {
  key: string
  name: string
  total: number
  isOther: boolean
}

// Append an "Other (N)" row when the backend signals more entries exist
// beyond the top 5. Its total = grand_total - sum(top 5), which the card
// also uses to size the row's proportional fill.
function withOtherRow(rows: BreakdownRow[], otherCount: number, grandTotal: number): BreakdownRow[] {
  if (otherCount <= 0) return rows
  const topSum = rows.reduce((sum, r) => sum + r.total, 0)
  const otherTotal = Math.max(grandTotal - topSum, 0)
  return [...rows, { key: 'other', name: `Other (${otherCount})`, total: otherTotal, isOther: true }]
}

// Shared presentation for the spending-by-category and top-merchants cards.
// Each row has a colored fill proportional to its share of grandTotal,
// with "Other" rendered in neutral gray. The Total row is pinned to the
// bottom via a flex-1 spacer so sparse cards don't collapse in height.
function BreakdownCard({
  title,
  rangeLabel,
  range,
  onRangeChange,
  rows,
  grandTotal,
  currency,
  emptyLabel,
}: {
  title: string
  rangeLabel: string
  range: SpendingRange
  onRangeChange: (r: SpendingRange) => void
  rows: BreakdownRow[]
  grandTotal: number
  currency: string
  emptyLabel: string
}) {
  return (
    <section
      className="app-card p-6 flex flex-col"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">{title}</p>
        <div
          className="app-segmented-control"
          role="tablist"
          aria-label={rangeLabel}
        >
          {SPENDING_RANGES.map((r) => {
            const active = range === r
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onRangeChange(r)}
                className={`app-segmented-option ${active ? 'app-segmented-option-active' : ''}`}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          {emptyLabel}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5" style={{ minHeight: 224 }}>
            {rows.map((item, idx) => {
              // Bar width = this row's share of total — so a row at 50% of
              // total fills halfway. 4% minimum keeps tiny slivers visible.
              // Uses absolute values because totals are signed negatives.
              const totalAbs = Math.abs(grandTotal)
              const barPct = totalAbs > 0 ? Math.max((Math.abs(item.total) / totalAbs) * 100, 4) : 0
              const color = item.isOther ? '#8C8074' : CATEGORY_COLORS[idx % CATEGORY_COLORS.length]
              return (
                <div
                  key={item.key}
                  className="relative flex items-center gap-3 rounded-xl py-2.5 px-3 overflow-hidden"
                  style={{ background: 'var(--app-bg)' }}
                >
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{ width: `${barPct}%`, backgroundColor: color, opacity: 0.35 }}
                  />
                  <div
                    className="w-2 h-2 rounded-full shrink-0 relative"
                    style={{ backgroundColor: color }}
                  />
                  <span
                    className={`flex-1 truncate relative text-sm font-medium ${item.isOther ? 'italic' : ''}`}
                  >
                    {item.name}
                  </span>
                  <span className="font-financial font-medium tabular-nums relative text-sm">
                    {formatCurrency(item.total, currency)}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Spacer pushes the Total row to the bottom regardless of row count. */}
          <div className="flex-1" />

          <div
            className="flex items-center gap-3 pt-3"
            style={{ borderTop: '1px solid var(--app-border)' }}
          >
            <div className="w-2 shrink-0" />
            <span
              className="flex-1 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--app-text-muted)' }}
            >
              Total
            </span>
            <span className="font-financial font-semibold tabular-nums text-sm">
              {formatCurrency(grandTotal, currency)}
            </span>
          </div>
        </>
      )}
    </section>
  )
}

function TopCategoriesBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data } = useAccountSpendingBreakdown(account.id, range)

  const rows = breakdownToRows(
    data,
    (b) => b.top_categories.map((c) => ({
      key: c.category_id, name: c.name, total: c.total, isOther: false,
    })),
    (b) => b.other_categories_count,
  )

  return (
    <BreakdownCard
      title="Categories by Spending"
      rangeLabel="Spending range"
      range={range}
      onRangeChange={setRange}
      rows={rows}
      grandTotal={data?.grand_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No spending in this range"
    />
  )
}

function TopMerchantsBySpendingCard({ account }: { account: Account }) {
  const [range, setRange] = useState<SpendingRange>('MTD')
  const { data } = useAccountSpendingBreakdown(account.id, range)

  const rows = breakdownToRows(
    data,
    (b) => b.top_merchants.map((m) => ({
      key: m.merchant_id, name: m.name, total: m.total, isOther: false,
    })),
    (b) => b.other_merchants_count,
  )

  return (
    <BreakdownCard
      title="Merchants by Spending"
      rangeLabel="Merchant range"
      range={range}
      onRangeChange={setRange}
      rows={rows}
      grandTotal={data?.grand_total_spend ?? 0}
      currency={account.currency}
      emptyLabel="No merchant activity in this range"
    />
  )
}

// Project the breakdown payload into BreakdownRow[] + the "Other (N)" row
// when one is needed. Each caller supplies the top-N extractor and the
// matching other-count accessor so categories and merchants share the shape.
function breakdownToRows(
  data: AccountSpendingBreakdown | undefined,
  toRows: (b: AccountSpendingBreakdown) => BreakdownRow[],
  otherCount: (b: AccountSpendingBreakdown) => number,
): BreakdownRow[] {
  if (!data) return []
  return withOtherRow(toRows(data), otherCount(data), data.grand_total_spend)
}

// Monthly cash-flow card — a compact "N months avg" summary (left) paired
// with a grouped bar chart of the recent monthly history (right). Mirrors the
// old-repo "Monthly Cash Flow" design but swaps the Recurring-vs-One-time
// sidebar for a simple In/Out average since categories don't yet carry a
// recurring signal.
//
// ``CASH_FLOW_AVG_MONTHS`` completed months are used for the average so a
// partial in-progress month can't drag it down. One extra month is fetched so
// the chart still shows the in-progress current month alongside the history.
const CASH_FLOW_AVG_MONTHS = 6
const CASH_FLOW_CHART_MONTHS = CASH_FLOW_AVG_MONTHS + 1

// Cash-flow bar chart — one BarChart used twice in the same card. Once for
// the monthly history, once for the N-month average. Both callers pass the
// same ``domain`` so bars are visually comparable at a glance.
interface CashFlowBar {
  label: string
  income: number
  expense: number
}

function CashFlowBarChart({
  data,
  domain,
  currency,
  tooltipLabel,
}: {
  data: CashFlowBar[]
  domain: [number, number]
  currency: string
  tooltipLabel: (label: string) => string
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
        barGap={2}
        barCategoryGap="18%"
      >
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
          tickMargin={4}
          interval={0}
        />
        <YAxis hide domain={domain} />
        <Tooltip
          cursor={{ fill: 'var(--app-accent-soft)', radius: 4 }}
          wrapperStyle={TOOLTIP_WRAPPER_STYLE}
          contentStyle={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            borderRadius: 8,
            boxShadow: 'var(--app-shadow-soft)',
            padding: '6px 10px',
            fontSize: 13,
          }}
          labelStyle={{ color: 'var(--app-text-subtle)' }}
          itemStyle={{ color: 'var(--app-text)' }}
          labelFormatter={(label) => tooltipLabel(String(label))}
          formatter={(value, name) => [
            formatCurrency(Number(value), currency),
            name === 'income' ? 'In' : 'Out',
          ]}
        />
        <Bar
          dataKey="income"
          fill="var(--app-positive)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          opacity={0.85}
        />
        <Bar
          dataKey="expense"
          fill="var(--app-negative)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          opacity={0.85}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function MonthlyCashFlowCard({ account }: { account: Account }) {
  const { data } = useAccountCashFlow(account.id, CASH_FLOW_CHART_MONTHS)

  const chartData = useMemo(
    () =>
      (data ?? []).map((row: AccountMonthlyCashFlow) => ({
        label: parseYmdLocal(row.month).toLocaleDateString('en-US', { month: 'short' }),
        tooltipLabel: parseYmdLocal(row.month).toLocaleDateString('en-US', {
          month: 'short',
          year: 'numeric',
        }),
        income: row.income,
        expense: row.expenses,
      })),
    [data],
  )
  const hasActivity = chartData.some((m) => m.income > 0 || m.expense > 0)

  // Average the completed prior months only — drop the last entry (the in-
  // progress current month) so a partial month doesn't drag the stat down.
  // Dormant months in the window still count as $0 so the number stays stable
  // across the month rather than jumping each time a new month begins.
  const { avgIn, avgOut } = useMemo(() => {
    if (!data || data.length <= 1) return { avgIn: 0, avgOut: 0 }
    const completed = data.slice(0, -1)
    const totalIn = completed.reduce((sum, m) => sum + m.income, 0)
    const totalOut = completed.reduce((sum, m) => sum + m.expenses, 0)
    return {
      avgIn: Math.round(totalIn / completed.length),
      avgOut: Math.round(totalOut / completed.length),
    }
  }, [data])

  // Shared Y-axis ceiling so the avg bar's height is directly comparable to
  // the monthly bars — the whole reason the avg sits inside the same card.
  const yMax = useMemo(() => {
    const monthlyPeak = chartData.reduce(
      (peak, m) => Math.max(peak, m.income, m.expense),
      0,
    )
    // 1 floor keeps Recharts from collapsing to a zero-height domain when
    // everything is empty (which is mostly defensive — hasActivity gates this
    // branch anyway).
    return Math.max(monthlyPeak, avgIn, avgOut, 1)
  }, [chartData, avgIn, avgOut])

  const avgData: CashFlowBar[] = [
    { label: `${CASH_FLOW_AVG_MONTHS} Mo Avg`, income: avgIn, expense: avgOut },
  ]
  const monthlyLabelByKey = new Map(chartData.map((m) => [m.label, m.tooltipLabel]))

  return (
    <section
      className="app-card p-6 flex flex-col"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">Monthly Cash Flow</p>
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-positive)' }} />
            In
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-negative)' }} />
            Out
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-[200px] w-full flex gap-4">
        <div className="flex-1 min-w-0">
          {!hasActivity ? (
            <div
              className="h-full w-full flex items-center justify-center text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              No cash flow yet
            </div>
          ) : (
            <CashFlowBarChart
              data={chartData}
              domain={[0, yMax]}
              currency={account.currency}
              tooltipLabel={(label) => monthlyLabelByKey.get(label) ?? label}
            />
          )}
        </div>

        {hasActivity && (
          <>
            <div
              className="shrink-0 self-stretch"
              style={{ borderLeft: '1px dashed var(--app-border-strong)' }}
              aria-hidden
            />
            <div className="shrink-0" style={{ width: 72 }}>
              <CashFlowBarChart
                data={avgData}
                domain={[0, yMax]}
                currency={account.currency}
                tooltipLabel={() => `${CASH_FLOW_AVG_MONTHS}-month average`}
              />
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// Parse a "YYYY-MM-DD" calendar date as local midnight — new Date("YYYY-MM-DD")
// treats it as UTC and drifts a day in negative-offset timezones.
function parseYmdLocal(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Compact label for the date-range filter chip. Drops the duplicate year when
// both bounds fall in the same year. Mirrors the Transactions page so the chip
// reads identically across pages.
function formatDateRangeLabel(from?: string, to?: string): string | null {
  if (!from && !to) return null
  const parse = (s: string) => parseYmdLocal(s)
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString('en-US', opts)
  if (from && to) {
    const fromDate = parse(from)
    const toDate = parse(to)
    const sameYear = fromDate.getFullYear() === toDate.getFullYear()
    return sameYear
      ? `${fmt(fromDate, { month: 'short', day: 'numeric' })} – ${fmt(toDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : `${fmt(fromDate, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(toDate, { month: 'short', day: 'numeric', year: 'numeric' })}`
  }
  if (from) return `From ${fmt(parse(from), { month: 'short', day: 'numeric', year: 'numeric' })}`
  return `Until ${fmt(parse(to!), { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// Filter values exposed to the user on the per-account transactions section.
// account_id is fixed by the route, so it's not part of the chip set — only
// the rest of the API filter surface that's worth surfacing for browsing.
interface AccountTransactionFilters {
  category_id?: string
  from_date?: string
  to_date?: string
}

// Group transactions by calendar day, preserving input order within each group.
function groupByDate(transactions: Transaction[]): { dateLabel: string; transactions: Transaction[] }[] {
  const groups: { dateLabel: string; transactions: Transaction[] }[] = []
  let currentLabel = ''
  for (const txn of transactions) {
    const label = parseYmdLocal(txn.dt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (label !== currentLabel) {
      groups.push({ dateLabel: label, transactions: [] })
      currentLabel = label
    }
    groups[groups.length - 1].transactions.push(txn)
  }
  return groups
}

function TransactionListSection({
  account,
  onCreateTransaction,
  onEditTransaction,
}: {
  account: Account
  onCreateTransaction: () => void
  onEditTransaction: (t: Transaction) => void
}) {
  // `search` mirrors the input in real time; `activeSearch` is what's actually
  // sent to the API. Catches up 1s after typing pauses (or immediately on
  // Enter) so the input stays responsive without thrashing the server.
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setActiveSearch(search), 1000)
    return () => clearTimeout(timer)
  }, [search])

  const [filters, setFilters] = useState<AccountTransactionFilters>({})
  const setFilter = (patch: Partial<AccountTransactionFilters>) => {
    setFilters((f) => {
      const next = { ...f, ...patch }
      for (const key of Object.keys(next) as (keyof AccountTransactionFilters)[]) {
        if (!next[key]) delete next[key]
      }
      return next
    })
  }

  // Date-range chip — drafts (`pendingFrom` / `pendingTo`) only become applied
  // filters when the user clicks Apply or closes the popover. An invalid
  // range (from > to) is reverted on close and blocks Apply. Drafts re-sync
  // when filters change externally; the "adjust state during render" pattern
  // mirrors the main Transactions page.
  const [pendingFrom, setPendingFrom] = useState(filters.from_date ?? '')
  const [pendingTo, setPendingTo] = useState(filters.to_date ?? '')
  const [syncedRange, setSyncedRange] = useState({
    from: filters.from_date,
    to: filters.to_date,
  })
  if (syncedRange.from !== filters.from_date || syncedRange.to !== filters.to_date) {
    setSyncedRange({ from: filters.from_date, to: filters.to_date })
    setPendingFrom(filters.from_date ?? '')
    setPendingTo(filters.to_date ?? '')
  }
  const dateRangeInvalid = !!pendingFrom && !!pendingTo && pendingFrom > pendingTo
  const dateRangeChanged =
    (pendingFrom || undefined) !== filters.from_date ||
    (pendingTo || undefined) !== filters.to_date
  const commitDateRange = () => {
    if (dateRangeInvalid) {
      setPendingFrom(filters.from_date ?? '')
      setPendingTo(filters.to_date ?? '')
      return
    }
    const nextFrom = pendingFrom || undefined
    const nextTo = pendingTo || undefined
    if (nextFrom === filters.from_date && nextTo === filters.to_date) return
    setFilter({ from_date: nextFrom, to_date: nextTo })
  }

  const {
    data: txnPages,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteTransactions({
    account_id: account.id,
    ...filters,
    q: activeSearch || undefined,
  })
  const transactions = useMemo(() => txnPages?.pages.flat() ?? [], [txnPages])

  const { data: categories } = useCategories()
  const { data: merchants } = useMerchants()
  const categoryMap = useMemo(
    () => new Map(categories?.map((c) => [c.id, c]) ?? []),
    [categories],
  )
  const merchantMap = useMemo(
    () => new Map(merchants?.map((m) => [m.id, m]) ?? []),
    [merchants],
  )

  const dateGroups = useMemo(() => groupByDate(transactions), [transactions])
  const transactionsLoaded = txnPages !== undefined

  // Infinite scroll — keep fetching as the sentinel enters the viewport.
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return
    const el = sentinelRef.current
    if (!el) return
    let requested = false
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !requested) {
        requested = true
        fetchNextPage()
      }
    }, { rootMargin: '200px' })
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <>
      {/* Sticky toolbar — mirrors the main Transactions page so search +
          filter chips behave identically across both surfaces. */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 py-3 mb-2"
        style={{ background: 'var(--app-bg)' }}
      >
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--app-text-subtle)' }}
            aria-hidden
          />
          <input
            type="text"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setActiveSearch(search)
            }}
            className="app-input w-full pl-9"
          />
        </div>

        <FilterChip
          label="Category"
          selectedLabel={categories?.find((c) => c.id === filters.category_id)?.name ?? null}
          onClear={() => setFilter({ category_id: undefined })}
        >
          {(close) => {
            const KIND_LABELS: Record<string, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' }
            const opts = (['expense', 'income', 'transfer'] as const).flatMap((kind) =>
              (categories ?? [])
                .filter((c) => c.kind === kind)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => ({ value: c.id, label: c.name, group: KIND_LABELS[kind] })),
            )
            return (
              <FilterOptionList
                options={opts}
                selectedValue={filters.category_id}
                onSelect={(v) => { setFilter({ category_id: v }); close() }}
                searchPlaceholder="Search categories..."
              />
            )
          }}
        </FilterChip>

        <FilterChip
          label="Date range"
          selectedLabel={formatDateRangeLabel(filters.from_date, filters.to_date)}
          onClear={() => setFilter({ from_date: undefined, to_date: undefined })}
          onClose={commitDateRange}
          panelClassName="w-72 p-4 space-y-3"
        >
          {(close) => (
            <>
              <div>
                <label className="app-label block mb-1.5">From</label>
                <input
                  type="date"
                  className="app-input w-full"
                  value={pendingFrom}
                  onChange={(e) => setPendingFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="app-label block mb-1.5">To</label>
                <input
                  type="date"
                  className="app-input w-full"
                  value={pendingTo}
                  onChange={(e) => setPendingTo(e.target.value)}
                />
              </div>
              {dateRangeInvalid && (
                <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
                  From date must be on or before To date.
                </p>
              )}
              <div className="!mt-5 flex gap-2">
                <button
                  type="button"
                  className="app-secondary-button flex-1 justify-center"
                  disabled={!pendingFrom && !pendingTo}
                  onClick={() => {
                    setPendingFrom('')
                    setPendingTo('')
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="app-primary-button flex-1 justify-center"
                  disabled={dateRangeInvalid || !dateRangeChanged}
                  onClick={close}
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </FilterChip>

        <button
          type="button"
          className="app-primary-button"
          onClick={onCreateTransaction}
        >
          <Plus size={16} aria-hidden />
          Add Transaction
        </button>
      </div>

      {error ? (
        <p className="py-2 font-medium" style={{ color: 'var(--app-negative)' }}>
          Unable to load transactions.
        </p>
      ) : transactionsLoaded && dateGroups.length === 0 ? (
        <p
          className="py-8 text-center italic text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          {search ? 'No transactions match your search.' : 'No transactions yet.'}
        </p>
      ) : transactionsLoaded ? (
        <section className="space-y-4">
          {dateGroups.map(({ dateLabel, transactions: txns }) => {
            const dailyTotal = txns.reduce((sum, t) => sum + t.amount, 0)
            const dailyColor = dailyTotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
            return (
              <div key={dateLabel}>
                <div
                  className="sticky top-[6rem] z-10 flex items-center justify-between px-3 py-2 rounded-lg"
                  style={{
                    background: 'var(--app-input-bg)',
                    borderBottom: '1px solid var(--app-border)',
                  }}
                >
                  <p
                    className="text-sm font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {dateLabel}
                  </p>
                  <p
                    className="font-financial text-sm font-medium"
                    style={{ color: dailyColor }}
                  >
                    {formatCurrency(dailyTotal, account.currency)}
                  </p>
                </div>

                <div>
                  {txns.map((t) => {
                    const isIncome = t.amount > 0
                    const category = categoryMap.get(t.category_id)
                    const merchantName = t.merchant_id ? merchantMap.get(t.merchant_id)?.name : null
                    const categoryIcon = category?.icon ?? DEFAULT_CATEGORY_ICON
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onEditTransaction(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onEditTransaction(t)
                          }
                        }}
                        className="flex items-center gap-4 py-3.5 px-3 cursor-pointer transition-colors duration-100 hover:bg-[var(--app-surface-soft)]"
                        style={{ borderBottom: '1px solid var(--app-border)' }}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                          <span className="text-lg leading-none" aria-hidden>
                            {categoryIcon}
                          </span>
                        </div>
                        {/* Merchant cell — second line kept blank (nbsp) so row
                            height matches the Transactions page, which uses it
                            for account name. */}
                        <div className="min-w-0 w-80 shrink-0">
                          <p className="font-medium truncate">{merchantName ?? 'Transfer'}</p>
                          <p
                            className="text-sm mt-0.5 truncate"
                            style={{ color: 'var(--app-text-muted)' }}
                          >
                            {' '}
                          </p>
                        </div>
                        <p
                          className="min-w-0 flex-1 truncate"
                          style={{ color: 'var(--app-text-subtle)' }}
                        >
                          {t.notes ?? ' '}
                        </p>
                        <span
                          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                          style={{
                            background: 'var(--app-surface-soft)',
                            color: 'var(--app-text-muted)',
                            border: '1px solid var(--app-border)',
                          }}
                        >
                          {category?.name ?? 'Uncategorized'}
                        </span>
                        <p
                          className="font-financial font-medium shrink-0 tabular-nums w-28 text-right"
                          style={{ color: isIncome ? 'var(--app-positive)' : 'var(--app-text)' }}
                        >
                          {t.amount >= 0 ? '+' : '-'}{formatCurrency(Math.abs(t.amount), account.currency)}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
          {hasNextPage === false ? (
            <p className="py-4 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              You've reached the end.
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  )
}

function BalanceChartCard({ account }: { account: Account }) {
  const [range, setRange] = useState<BalanceRange>('30D')

  // Derive the window + granularity from the selected range. Memoized on
  // range so the query key stays stable across renders.
  const { fromDate, granularity } = useMemo(() => {
    const cfg = RANGE_CONFIG[range]
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const from = new Date(today)
    from.setDate(from.getDate() - (cfg.days - 1))
    return { fromDate: from, granularity: cfg.granularity }
  }, [range])

  const { data: snapshots } = useAccountSnapshots(account.id, {
    fromDate: toISODate(fromDate),
    granularity,
    includeAnchor: true,
  })

  const series = useMemo(
    () => buildChartSeries(snapshots ?? [], fromDate, granularity),
    [snapshots, fromDate, granularity],
  )

  // First chart point whose year differs from the previous point — drives the
  // dashed year-boundary marker so the user can tell where one year ends.
  let yearBoundary: { dateKey: string; year: string } | null = null
  for (let i = 1; i < series.length; i++) {
    if (series[i].date.slice(0, 4) !== series[i - 1].date.slice(0, 4)) {
      yearBoundary = { dateKey: series[i].date, year: series[i].date.slice(0, 4) }
      break
    }
  }

  // Period delta — first vs last point in the visible window. Drives the
  // up/down pill and the line color.
  const periodDelta = useMemo(() => {
    if (series.length < 2) return null
    const start = series[0].balance
    const end = series[series.length - 1].balance
    const absolute = end - start
    const pct = start === 0 ? null : (absolute / Math.abs(start)) * 100
    return { absolute, pct }
  }, [series])

  const trendUp = periodDelta !== null && periodDelta.absolute >= 0
  const lineColor = account.current_balance < 0 ? 'var(--app-negative)' : 'var(--app-accent)'
  const deltaColor = periodDelta === null
    ? 'var(--app-text-muted)'
    : trendUp
      ? 'var(--app-positive)'
      : 'var(--app-negative)'

  return (
    <section
      className="app-card p-6 flex flex-col"
    >
      {/* Header — label + range pills */}
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <p className="app-label">Current Balance</p>
        <div
          className="app-segmented-control"
          role="tablist"
          aria-label="Balance range"
        >
          {BALANCE_RANGES.map((r) => {
            const active = range === r
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setRange(r)}
                className={`app-segmented-option ${active ? 'app-segmented-option-active' : ''}`}
              >
                {r}
              </button>
            )
          })}
        </div>
      </div>

      {/* Current balance + period delta */}
      <div className="mb-4">
        <p
          className="font-financial font-normal leading-none text-3xl"
          style={{ color: account.current_balance < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
        >
          {formatCurrency(account.current_balance, account.currency)}
        </p>
        {periodDelta !== null && (
          <div className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: deltaColor }}>
            {trendUp ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
            <span>
              {trendUp ? '+' : '−'}
              {formatCurrency(Math.abs(periodDelta.absolute), account.currency)}
              {periodDelta.pct !== null && (
                <>
                  {' '}
                  ({trendUp ? '+' : '−'}
                  {Math.abs(periodDelta.pct).toFixed(1)}%)
                </>
              )}
            </span>
            <span style={{ color: 'var(--app-text-subtle)' }}>· {range.toLowerCase()}</span>
          </div>
        )}
      </div>

      {/* Chart fills the remaining space. 240px min keeps it usable even on
          short identity cards; stretches taller when grid row grows. */}
      <div className="flex-1 min-h-[240px] w-full">
        {series.length < 2 ? (
          <div
            className="h-full w-full rounded-lg flex items-center justify-center text-sm"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            Not enough history yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 18, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id={`balanceFill-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={40}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                tickMargin={4}
                tickFormatter={(value: string) =>
                  series.find((s) => s.date === value)?.dateLabel ?? value
                }
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                wrapperStyle={TOOLTIP_WRAPPER_STYLE}
                cursor={{ stroke: 'var(--app-border-strong)', strokeWidth: 1 }}
                contentStyle={{
                  background: 'var(--app-bg)',
                  border: '1px solid var(--app-border-strong)',
                  borderRadius: 8,
                  boxShadow: 'var(--app-shadow-soft)',
                  padding: '6px 10px',
                  fontSize: 13,
                }}
                labelStyle={{ color: 'var(--app-text-subtle)' }}
                itemStyle={{ color: 'var(--app-text)' }}
                labelFormatter={(value) =>
                  series.find((s) => s.date === value)?.tooltipLabel ?? String(value)
                }
                formatter={(value) => [formatCurrency(Number(value), account.currency), 'Balance']}
              />
              <ReferenceLine
                y={0}
                stroke="var(--app-text-subtle)"
                strokeDasharray="4 3"
                strokeWidth={2}
                ifOverflow="extendDomain"
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#balanceFill-${account.id})`}
              />
              {yearBoundary && (
                <ReferenceLine
                  x={yearBoundary.dateKey}
                  stroke="var(--app-text-muted)"
                  strokeDasharray="4 3"
                  strokeWidth={1}
                  label={{
                    value: yearBoundary.year,
                    position: 'top',
                    fill: 'var(--app-text-muted)',
                    fontSize: 11,
                  }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

function BackLink() {
  return (
    <Link
      to="/accounts"
      className="inline-flex items-center gap-1.5 text-sm mb-6"
      style={{ color: 'var(--app-text-muted)' }}
    >
      <ArrowLeft size={14} aria-hidden />
      Back to accounts
    </Link>
  )
}

export default function AccountDetail() {
  const { accountId } = useParams<{ accountId: string }>()
  const { data: account, error } = useAccount(accountId)
  const linkedTaxAdvantagedPlanId = account?.group_id === null ? account.tax_advantaged_plan_id : null
  const {
    data: linkedTaxAdvantagedPlan,
    error: linkedTaxAdvantagedPlanError,
  } = useTaxAdvantagedPlan(linkedTaxAdvantagedPlanId)

  // Transaction modal state — lifted up from TransactionListCard so the
  // "Add transaction" button can live outside the card next to the section
  // title, while row-click edits still drive the same modal.
  const [showTxnModal, setShowTxnModal] = useState(false)
  const [txnModalKey, setTxnModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [showAccountEditModal, setShowAccountEditModal] = useState(false)

  const openCreateTransaction = () => {
    setEditingTransaction(null)
    setTxnModalKey((k) => k + 1)
    setShowTxnModal(true)
  }
  const openEditTransaction = (t: Transaction) => {
    setEditingTransaction(t)
    setTxnModalKey((k) => k + 1)
    setShowTxnModal(true)
  }

  if (!account && !error) {
    return (
      <div>
        <BackLink />
      </div>
    )
  }

  if (error || !account) {
    return (
      <div>
        <BackLink />
        <h1 className="app-page-title">Account not found</h1>
        <p className="app-page-description">We couldn't load this account. It may have been deleted.</p>
      </div>
    )
  }

  const identityFacts: { label: string; value: string }[] = [
    { label: 'Kind', value: ACCOUNT_KIND_LABEL[account.account_kind] ?? account.account_kind },
    { label: 'Type', value: humanizeAccountType(account.account_type) },
    { label: 'Currency', value: account.currency },
    {
      label: 'Credit limit',
      value: account.credit_limit === null ? '—' : formatCurrency(account.credit_limit, account.currency),
    },
  ]

  return (
    <div>
      <BackLink />

      {/* Two-column layout: identity card (fixed) + chart area (flex).
          The chart side is a placeholder for step 4. */}
      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5">
        <section
          className="app-card relative flex min-h-[440px] flex-col p-6"
        >
          {!account.closed_at && (
            <button
              type="button"
              aria-label="Edit account"
              className="app-icon-button absolute right-6 top-6"
              onClick={() => setShowAccountEditModal(true)}
            >
              <Pencil size={14} aria-hidden />
            </button>
          )}

          <DetailInstitutionLogo institution={account.institution} />

          <h1 className="mt-4 font-serif text-[1.375rem] font-semibold leading-tight">{account.name}</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {account.institution?.name ?? 'No institution'}
            {account.closed_at && ` · Closed ${new Date(account.closed_at).toLocaleDateString()}`}
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
            {identityFacts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
                  {fact.label}
                </dt>
                <dd className="mt-0.5 truncate text-sm font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {linkedTaxAdvantagedPlanId ? (
            <TaxAdvantagedCategoryBand
              plan={linkedTaxAdvantagedPlan}
              hasError={!!linkedTaxAdvantagedPlanError}
            />
          ) : (
            <StandardAccountBand />
          )}
        </section>

        <BalanceChartCard account={account} />
      </div>

      {/* Secondary row: 3 equal columns. */}
      <div className="mt-5 grid grid-cols-3 gap-5">
        <TopCategoriesBySpendingCard account={account} />
        <TopMerchantsBySpendingCard account={account} />
        <MonthlyCashFlowCard account={account} />
      </div>

      <div className="mt-5">
        <h2 className="font-serif font-medium text-4xl leading-none mb-4">Transactions</h2>
        <TransactionListSection
          account={account}
          onCreateTransaction={openCreateTransaction}
          onEditTransaction={openEditTransaction}
        />
      </div>

      <CreateTransactionModal
        key={txnModalKey}
        open={showTxnModal}
        onClose={() => setShowTxnModal(false)}
        transaction={editingTransaction ?? undefined}
        defaultAccountId={account.id}
        defaultCurrency={account.currency}
      />

      {showAccountEditModal && (
        <EditAccountIdentityModal
          account={account}
          onClose={() => setShowAccountEditModal(false)}
        />
      )}
    </div>
  )
}
