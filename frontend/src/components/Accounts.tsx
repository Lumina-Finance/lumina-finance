import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  useAccounts,
  type AccountKind,
  type AccountType,
  type AccountsOverview,
  type TaxTreatment,
} from '@/api/accounts'
import { useTransactionsOverview } from '@/api/transactions'
import { useRunway } from '@/api/user'
import { useFocusRefetch } from '@/hooks/useFocusRefetch'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  RUNWAY_BAND_STYLE,
  RUNWAY_TARGET_MONTHS,
  formatCompactRunway,
  runwayBand,
} from '@/utils/runway'
import CreateAccountModal from '@/components/CreateAccountModal'
import FilterChip from '@/components/FilterChip'
import FilterOptionList, { type OptionItem } from '@/components/FilterOptionList'

interface AccountFilterValues {
  institution_id?: string
  account_kind?: AccountKind
  account_type?: AccountType
  tax_treatment?: TaxTreatment
}

const ACCOUNT_KIND_OPTIONS: OptionItem[] = [
  { value: 'asset', label: 'Assets' },
  { value: 'revolving', label: 'Revolving credit' },
  { value: 'amortizing', label: 'Amortizing debt' },
]

// Grouped by kind so the popover mirrors the three sections used elsewhere on
// the page. Labels reuse humanizeAccountType's output shape (HELOC kept as an
// acronym).
const ACCOUNT_TYPE_OPTIONS: OptionItem[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing debt' },
]

const TAX_TREATMENT_OPTIONS: OptionItem[] = [
  { value: 'taxable', label: 'Taxable' },
  { value: 'tax_free', label: 'Tax Free' },
  { value: 'tax_deferred', label: 'Tax Deferred' },
  { value: 'tax_assisted', label: 'Tax Assisted' },
]

function sumByKind(accounts: AccountsOverview[], kind: AccountKind): number {
  return accounts
    .filter((a) => a.account_kind === kind)
    .reduce((sum, a) => sum + a.current_balance, 0)
}

// Anything that isn't an asset counts as a debt for top-line totals (Net
// Worth, liabilities subtotal). The detail list below splits revolving vs
// amortizing into separate sections.
const isDebtAccount = (a: AccountsOverview) => a.account_kind !== 'asset'

// Turn a snake_case account_type enum value into a human label, e.g. "credit_card" → "Credit Card".
function humanizeAccountType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Fixed-size slot for an institution logo. Renders the image when available,
// otherwise a neutral circle with the first letter of the institution name
// (or "$" for cashflow-only accounts with no institution).
function InstitutionLogo({ institution }: { institution: AccountsOverview['institution'] }) {
  const initial = institution?.name?.[0]?.toUpperCase() ?? '$'
  return (
    <div
      className="w-9 h-9 shrink-0 rounded-lg overflow-hidden flex items-center justify-center"
      style={{
        background: 'var(--app-accent-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      {institution?.logo_url ? (
        <img
          src={institution.logo_url}
          alt={`${institution.name} logo`}
          className="w-full h-full object-contain"
          loading="lazy"
        />
      ) : (
        <span
          className="text-sm font-semibold select-none"
          style={{ color: 'var(--app-accent)' }}
        >
          {initial}
        </span>
      )}
    </div>
  )
}

// Each of the three account lists (assets / revolving credit / amortizing
// debt) shares the same editorial header + row layout. `accent` drives the
// title color, gutter bar, and (for debt kinds) a simpler balance color rule.
// `showCreditLimit` turns on the "avail." sub-line for revolving credit.
function AccountListSection({
  title,
  accent,
  accounts,
  subtotal,
  emptyLabel,
  displayCurrency,
  showCreditLimit = false,
}: {
  title: string
  accent: 'positive' | 'negative'
  accounts: AccountsOverview[]
  subtotal: number
  emptyLabel: string
  displayCurrency: string
  showCreditLimit?: boolean
}) {
  const titleColor = accent === 'positive' ? 'var(--app-positive)' : 'var(--app-negative)'
  const subtotalColor = accent === 'positive'
    ? subtotal >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
    : subtotal < 0 ? 'var(--app-negative)' : 'var(--app-text)'

  return (
    <section>
      {/* Editorial header — title ─── subtotal */}
      <div className="flex items-center gap-4 mb-2">
        <h3 className="font-serif font-semibold shrink-0 text-2xl" style={{ color: titleColor }}>
          {title}
        </h3>
        <div
          className="flex-1 h-px"
          style={{
            background:
              'linear-gradient(to right, var(--app-border-strong), var(--app-border), transparent)',
          }}
        />
        <span
          className="font-financial font-semibold shrink-0 text-xl"
          style={{ color: subtotalColor }}
        >
          {formatCurrency(subtotal, displayCurrency)}
        </span>
      </div>

      <div>
        {accounts.length === 0 ? (
          <p
            className="py-3 text-center italic text-sm"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            {emptyLabel}
          </p>
        ) : (
          accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              accent={accent}
              showCreditLimit={showCreditLimit}
              displayCurrency={displayCurrency}
            />
          ))
        )}
      </div>
    </section>
  )
}

function AccountRow({
  account,
  accent,
  showCreditLimit,
  displayCurrency,
}: {
  account: AccountsOverview
  accent: 'positive' | 'negative'
  showCreditLimit: boolean
  displayCurrency: string
}) {
  const barColor = accent === 'positive' ? 'var(--app-positive)' : 'var(--app-negative)'
  // Asset balances show green when positive; debt-kind sections stay neutral
  // when the balance is non-negative (an overpayment credit shouldn't read as
  // celebratory).
  const balanceColor =
    accent === 'positive'
      ? account.current_balance > 0
        ? 'var(--app-positive)'
        : account.current_balance < 0
          ? 'var(--app-negative)'
          : 'var(--app-text)'
      : account.current_balance < 0
        ? 'var(--app-negative)'
        : 'var(--app-text)'

  return (
    <div className="flex items-stretch rounded-xl">
      <div
        className="w-0.5 rounded-full my-3"
        style={{ background: barColor, opacity: 0.3 }}
      />
      <div className="flex-1 flex items-center gap-4 py-3.5 px-4">
        <InstitutionLogo institution={account.institution} />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{account.name}</p>
          <p className="text-sm mt-0.5" style={{ color: 'var(--app-text-muted)' }}>
            {humanizeAccountType(account.account_type)}
            {account.institution && ` · ${account.institution.name}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-financial font-medium" style={{ color: balanceColor }}>
            {formatCurrency(account.current_balance, displayCurrency)}
          </p>
          {showCreditLimit && account.credit_limit !== null && (
            <p
              className="font-financial mt-0.5 text-xs"
              style={{ color: 'var(--app-text-muted)' }}
            >
              {formatCurrency(account.credit_limit + account.current_balance, displayCurrency)} avail.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Accounts() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const { user } = useAuth()
  const { data: accounts, isLoading, error } = useAccounts()
  useFocusRefetch([['accounts'], ['transactions-overview']])

  const rows = useMemo(() => accounts ?? [], [accounts])
  const totalAssets = sumByKind(rows, 'asset')
  // Top-line debts aggregate revolving + amortizing — the detail list below
  // splits them into separate sections.
  const totalDebts = sumByKind(rows, 'revolving') + sumByKind(rows, 'amortizing')
  const netWorth = totalAssets - totalDebts
  const assetCount = rows.filter((a) => a.account_kind === 'asset').length
  const debtCount = rows.filter(isDebtAccount).length

  // Filters apply only to the Assets/Liabilities lists below — the headline
  // totals and metrics band above always reflect the full picture.
  const [filters, setFilters] = useState<AccountFilterValues>({})
  const setFilter = (patch: Partial<AccountFilterValues>) => {
    setFilters((f) => {
      const next = { ...f, ...patch }
      for (const key of Object.keys(next) as (keyof AccountFilterValues)[]) {
        if (!next[key]) delete next[key]
      }
      return next
    })
  }

  // Each filter only offers values the user actually has — a kind/type/tax/
  // institution with zero accounts would be a dead option that filters the
  // list to empty. Static option arrays drive the display order so grouping
  // and canonical ordering stay intact.
  const institutionOptions = useMemo<OptionItem[]>(() => {
    const seen = new Map<string, string>()
    for (const a of rows) {
      if (a.institution) seen.set(a.institution.id, a.institution.name)
    }
    return Array.from(seen, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const accountKindOptions = useMemo<OptionItem[]>(() => {
    const present = new Set(rows.map((a) => a.account_kind))
    return ACCOUNT_KIND_OPTIONS.filter((o) => present.has(o.value as AccountKind))
  }, [rows])

  const accountTypeOptions = useMemo<OptionItem[]>(() => {
    const present = new Set(rows.map((a) => a.account_type))
    return ACCOUNT_TYPE_OPTIONS.filter((o) => present.has(o.value as AccountType))
  }, [rows])

  const taxTreatmentOptions = useMemo<OptionItem[]>(() => {
    const present = new Set(rows.map((a) => a.tax_treatment))
    return TAX_TREATMENT_OPTIONS.filter((o) => present.has(o.value as TaxTreatment))
  }, [rows])

  const filteredRows = rows.filter((a) => {
    if (filters.institution_id && a.institution?.id !== filters.institution_id) return false
    if (filters.account_kind && a.account_kind !== filters.account_kind) return false
    if (filters.account_type && a.account_type !== filters.account_type) return false
    if (filters.tax_treatment && a.tax_treatment !== filters.tax_treatment) return false
    return true
  })

  // Assets / revolving credit / amortizing debt each get their own list
  // section. Within a section rows are ordered by balance descending — largest
  // holding (or most negative liability) surfaces first.
  const byBalanceDesc = (a: AccountsOverview, b: AccountsOverview) =>
    b.current_balance - a.current_balance
  const assetRows = filteredRows.filter((a) => a.account_kind === 'asset').sort(byBalanceDesc)
  const revolvingRows = filteredRows.filter((a) => a.account_kind === 'revolving').sort(byBalanceDesc)
  const amortizingRows = filteredRows.filter((a) => a.account_kind === 'amortizing').sort(byBalanceDesc)

  // Credit usage — scoped to revolving-credit products (credit cards, LOCs,
  // HELOCs). Amortizing debt doesn't have a limit concept. Liability balances
  // are stored signed (negative for debt), so flip sign so totalCreditUsed
  // reads as a positive "amount currently owed". Three states drive the
  // widget: no revolving accounts at all, revolving accounts but no limits
  // entered, and fully usable data — without this split the first two cases
  // collapse into a misleading green 0%.
  const revolvingAccounts = rows.filter((a) => a.account_kind === 'revolving')
  const creditAccountsWithLimits = revolvingAccounts.filter((a) => a.credit_limit !== null)
  const hasCreditAccounts = revolvingAccounts.length > 0
  const hasCreditData = creditAccountsWithLimits.length > 0
  const totalCreditUsed = creditAccountsWithLimits.reduce((sum, a) => sum - a.current_balance, 0)
  const totalCreditLimit = creditAccountsWithLimits.reduce((sum, a) => sum + (a.credit_limit ?? 0), 0)
  const creditUtilization =
    totalCreditLimit > 0 ? Math.round((totalCreditUsed / totalCreditLimit) * 100) : 0
  const creditUtilColor = !hasCreditData
    ? 'var(--app-text-subtle)'
    : creditUtilization <= 30
      ? 'var(--app-positive)'
      : creditUtilization <= 70
        ? 'var(--app-accent)'
        : 'var(--app-negative)'
  const displayCurrency = user!.base_currency

  // Current calendar month in user's timezone — drives the savings rate window.
  const { monthStart, today } = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      timeZone: user!.tz,
    })
    const todayStr = fmt.format(new Date())
    return { monthStart: `${todayStr.slice(0, 7)}-01`, today: todayStr }
  }, [user])

  const { data: overview } = useTransactionsOverview({
    from_date: monthStart,
    to_date: today,
  })

  const { data: runway } = useRunway()
  const runwayMonths = runway?.months ?? null
  const runwayBandKey = runwayBand(runwayMonths)
  const runwayStyle = runwayBandKey ? RUNWAY_BAND_STYLE[runwayBandKey] : null
  const runwayProgress =
    runwayMonths === null ? 0 : Math.min((runwayMonths / RUNWAY_TARGET_MONTHS) * 100, 100)
  const runwayCaption =
    !runway
      ? ''
      : runway.reason === 'no_accounts'
        ? 'Choose accounts in Settings'
        : runway.reason === 'insufficient_history'
          ? 'Need 1+ month of expense data'
          : `${formatCurrency(runway.avg_monthly_expense, displayCurrency)}/mo · ${runway.months_covered}mo basis`

  // Savings rate = (income − expenses) / income. outflow comes back negative,
  // so adding gives the net. Null when there is no income — either the month
  // had only expenses (treated as −∞%) or no activity at all (displayed as N/A).
  const savingsRate = useMemo<number | null>(() => {
    const inflow = overview?.total_inflow ?? 0
    const outflow = overview?.total_outflow ?? 0
    if (inflow <= 0) return null
    return Math.round(((inflow + outflow) / inflow) * 100)
  }, [overview])
  const savingsRateHasExpenses = (overview?.total_outflow ?? 0) < 0

  const savingsRateColor =
    savingsRate !== null
      ? savingsRate >= 20
        ? 'var(--app-positive)'
        : savingsRate >= 10
          ? 'var(--app-accent)'
          : 'var(--app-negative)'
      : savingsRateHasExpenses
        ? 'var(--app-negative)'
        : 'var(--app-text-subtle)'

  return (
    <div>
      <header className="app-page-header">
        <h1 className="app-page-title">My Accounts</h1>
      </header>

      <div className="space-y-6">
        {/* Net Worth statement — headline + assets/debts breakdown */}
        {isLoading ? (
          <div className="rounded-2xl h-[6.5rem] bg-gray-300" />
        ) : error ? (
          <p className="py-2 font-medium" style={{ color: 'var(--app-negative)' }}>
            Unable to load accounts.
          </p>
        ) : (
          <section>
            <div
              className="mb-5"
              style={{
                height: 1,
                background:
                  'linear-gradient(to right, var(--app-accent), var(--app-accent-border), transparent)',
              }}
            />
            <div className="flex items-end justify-between gap-6 flex-wrap">
              <div>
                <p className="app-label mb-1.5">Net Worth</p>
                <p
                  className="font-financial font-semibold tracking-tight leading-none text-[3.375rem]"
                  style={{
                    color: netWorth >= 0 ? 'var(--app-positive)' : 'var(--app-negative)',
                  }}
                >
                  {formatCurrency(netWorth, displayCurrency)}
                </p>
              </div>

              <div className="flex gap-8 pb-1.5">
                <div className="text-right">
                  <p className="app-label mb-0.5">Assets</p>
                  <p
                    className="font-financial font-medium text-xl"
                    style={{ color: totalAssets >= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
                  >
                    {formatCurrency(totalAssets, displayCurrency)}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    {assetCount} account{assetCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="app-label mb-0.5">Liabilities</p>
                  <p
                    className="font-financial font-medium text-xl"
                    style={{ color: totalDebts < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
                  >
                    {formatCurrency(totalDebts, displayCurrency)}
                  </p>
                  <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                    {debtCount} account{debtCount !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Metrics band — savings rate / credit usage / cash runway */}
        <section>
          {/* Gold top rule */}
          <div
            style={{
              height: 2,
              background: 'var(--app-accent)',
              opacity: 0.35,
              borderRadius: 1,
            }}
          />
          <div
            className="grid grid-cols-3 py-5"
            style={{ borderBottom: '1px solid var(--app-border-strong)' }}
          >
            {/* Savings Rate */}
            <div className="pr-6">
              <p className="app-label mb-1">Savings Rate</p>
              <p
                className="font-financial font-semibold text-[clamp(1rem,1.7vw,1.5rem)]"
                style={{ color: savingsRateColor }}
              >
                {savingsRate !== null
                  ? `${savingsRate}%`
                  : savingsRateHasExpenses
                    ? '−∞%'
                    : 'N/A'}
              </p>
              <div className="mt-2 space-y-1">
                <div
                  className="h-1 rounded-full overflow-hidden"
                  style={{ background: 'var(--app-border)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: savingsRateColor,
                      width: `${Math.max(0, Math.min(savingsRate ?? 0, 100))}%`,
                    }}
                  />
                </div>
                <p
                  className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
                  style={{ color: 'var(--app-text-subtle)' }}
                >
                  {savingsRate !== null
                    ? `${formatCurrency((overview?.total_inflow ?? 0) + (overview?.total_outflow ?? 0), displayCurrency)} of ${formatCurrency(overview?.total_inflow ?? 0, displayCurrency)} this month`
                    : savingsRateHasExpenses
                      ? 'No income this month'
                      : 'No data this month'}
                </p>
              </div>
            </div>

            {/* Credit Usage */}
            <div className="px-6" style={{ borderInline: '1px solid var(--app-border)' }}>
              <p className="app-label mb-1">Credit Usage</p>
              <p
                className="font-financial font-semibold text-[clamp(1rem,1.7vw,1.5rem)]"
                style={{ color: creditUtilColor }}
              >
                {hasCreditData ? `${creditUtilization}%` : 'N/A'}
              </p>
              <div className="mt-2 space-y-1">
                <div
                  className="h-1 rounded-full overflow-hidden"
                  style={{ background: 'var(--app-border)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: creditUtilColor,
                      width: `${hasCreditData ? Math.max(0, Math.min(creditUtilization, 100)) : 0}%`,
                    }}
                  />
                </div>
                <p
                  className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
                  style={{ color: 'var(--app-text-subtle)' }}
                >
                  {hasCreditData
                    ? `${formatCurrency(totalCreditUsed, displayCurrency)} of ${formatCurrency(totalCreditLimit, displayCurrency)}`
                    : hasCreditAccounts
                      ? 'No credit limits set'
                      : 'No revolving credit accounts'}
                </p>
              </div>
            </div>

            {/* Cash Runway */}
            <div className="pl-6">
              <div className="flex items-center gap-2 mb-1">
                <p className="app-label">Cash Runway</p>
                {runwayStyle && (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: runwayStyle.bg, color: runwayStyle.fg }}
                  >
                    {runwayStyle.label}
                  </span>
                )}
              </div>
              <p
                className="font-financial font-semibold text-[clamp(1rem,1.7vw,1.5rem)]"
                style={{ color: runwayMonths === null ? 'var(--app-text-subtle)' : 'var(--app-text)' }}
              >
                {formatCompactRunway(runwayMonths)}
              </p>
              <div className="mt-2 space-y-1">
                <div
                  className="h-1 rounded-full overflow-hidden"
                  style={{ background: 'var(--app-border)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{
                      background: 'linear-gradient(to right, var(--app-positive), var(--app-accent))',
                      width: `${runwayProgress}%`,
                    }}
                  />
                </div>
                <p
                  className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
                  style={{ color: 'var(--app-text-subtle)' }}
                >
                  {runwayCaption}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Filter row — institution / category / type / tax status */}
        <div className="flex flex-wrap items-center gap-4">
          <FilterChip
            label="Institution"
            selectedLabel={institutionOptions.find((o) => o.value === filters.institution_id)?.label ?? null}
            onClear={() => setFilter({ institution_id: undefined })}
          >
            {(close) => (
              <FilterOptionList
                options={institutionOptions}
                selectedValue={filters.institution_id}
                onSelect={(v) => { setFilter({ institution_id: v }); close() }}
                searchPlaceholder="Search institutions..."
              />
            )}
          </FilterChip>

          <FilterChip
            label="Category"
            selectedLabel={accountKindOptions.find((o) => o.value === filters.account_kind)?.label ?? null}
            onClear={() => setFilter({ account_kind: undefined })}
          >
            {(close) => (
              <FilterOptionList
                options={accountKindOptions}
                selectedValue={filters.account_kind}
                onSelect={(v) => { setFilter({ account_kind: v as AccountKind }); close() }}
                searchPlaceholder="Search categories..."
              />
            )}
          </FilterChip>

          <FilterChip
            label="Type"
            selectedLabel={accountTypeOptions.find((o) => o.value === filters.account_type)?.label ?? null}
            onClear={() => setFilter({ account_type: undefined })}
          >
            {(close) => (
              <FilterOptionList
                options={accountTypeOptions}
                selectedValue={filters.account_type}
                onSelect={(v) => { setFilter({ account_type: v as AccountType }); close() }}
                searchPlaceholder="Search types..."
              />
            )}
          </FilterChip>

          <FilterChip
            label="Tax Status"
            selectedLabel={taxTreatmentOptions.find((o) => o.value === filters.tax_treatment)?.label ?? null}
            onClear={() => setFilter({ tax_treatment: undefined })}
          >
            {(close) => (
              <FilterOptionList
                options={taxTreatmentOptions}
                selectedValue={filters.tax_treatment}
                onSelect={(v) => { setFilter({ tax_treatment: v as TaxTreatment }); close() }}
                searchPlaceholder="Search tax statuses..."
              />
            )}
          </FilterChip>

          <button
            type="button"
            className="app-secondary-button ml-auto"
            onClick={() => { setCreateModalKey((k) => k + 1); setShowCreateModal(true); }}
          >
            <Plus size={18} aria-hidden />
            Add Account
          </button>
        </div>

        <AccountListSection
          title="Assets"
          accent="positive"
          accounts={assetRows}
          subtotal={totalAssets}
          emptyLabel="No asset accounts"
          displayCurrency={displayCurrency}
        />

        <AccountListSection
          title="Revolving credit"
          accent="negative"
          accounts={revolvingRows}
          subtotal={sumByKind(rows, 'revolving')}
          emptyLabel="No revolving credit accounts"
          displayCurrency={displayCurrency}
          showCreditLimit
        />

        <AccountListSection
          title="Amortizing debt"
          accent="negative"
          accounts={amortizingRows}
          subtotal={sumByKind(rows, 'amortizing')}
          emptyLabel="No amortizing debt accounts"
          displayCurrency={displayCurrency}
        />

      </div>

      <CreateAccountModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  )
}
