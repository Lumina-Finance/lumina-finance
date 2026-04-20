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
import { useFocusRefetch } from '@/hooks/useFocusRefetch'
import { formatCurrency } from '@/utils/formatCurrency'
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
  { value: 'liability', label: 'Liabilities' },
]

// Grouped by kind so the popover mirrors the Assets/Liabilities split used
// elsewhere on the page. Labels reuse humanizeAccountType's output shape
// (HELOC kept as an acronym).
const ACCOUNT_TYPE_OPTIONS: OptionItem[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Liabilities' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Liabilities' },
  { value: 'heloc', label: 'HELOC', group: 'Liabilities' },
  { value: 'loan', label: 'Loan', group: 'Liabilities' },
  { value: 'mortgage', label: 'Mortgage', group: 'Liabilities' },
]

const TAX_TREATMENT_OPTIONS: OptionItem[] = [
  { value: 'taxable', label: 'Taxable' },
  { value: 'tax_free', label: 'Tax Free' },
  { value: 'tax_deferred', label: 'Tax Deferred' },
  { value: 'tax_assisted', label: 'Tax Assisted' },
]

function sumByKind(accounts: AccountsOverview[], kind: 'asset' | 'liability'): number {
  return accounts
    .filter((a) => a.account_kind === kind)
    .reduce((sum, a) => sum + a.current_balance, 0)
}

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

export default function Accounts() {
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const { user } = useAuth()
  const { data: accounts, isLoading, error } = useAccounts()
  useFocusRefetch([['accounts'], ['transactions-overview']])

  const rows = useMemo(() => accounts ?? [], [accounts])
  const totalAssets = sumByKind(rows, 'asset')
  const totalDebts = sumByKind(rows, 'liability')
  const netWorth = totalAssets - totalDebts
  const assetCount = rows.filter((a) => a.account_kind === 'asset').length
  const debtCount = rows.filter((a) => a.account_kind === 'liability').length

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

  // Debts ordered by balance descending — largest liability surfaces first.
  const debtRows = filteredRows
    .filter((a) => a.account_kind === 'liability')
    .sort((a, b) => b.current_balance - a.current_balance)

  // Assets ordered by balance descending — largest holding surfaces first.
  const assetRows = filteredRows
    .filter((a) => a.account_kind === 'asset')
    .sort((a, b) => b.current_balance - a.current_balance)

  // Credit usage — aggregate over liability accounts that have a credit_limit set.
  // Loan-style liabilities (mortgages, term loans) have no limit and are excluded.
  // Liability balances are stored signed (negative for debt), so flip sign here
  // so totalCreditUsed reads as a positive "amount currently owed".
  const creditAccounts = rows.filter(
    (a) => a.account_kind === 'liability' && a.credit_limit !== null,
  )
  const totalCreditUsed = creditAccounts.reduce((sum, a) => sum - a.current_balance, 0)
  const totalCreditLimit = creditAccounts.reduce((sum, a) => sum + (a.credit_limit ?? 0), 0)
  const creditUtilization =
    totalCreditLimit > 0 ? Math.round((totalCreditUsed / totalCreditLimit) * 100) : 0
  const creditUtilColor =
    creditUtilization <= 30
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

  // Savings rate = (income − expenses) / income. outflow comes back negative,
  // so adding gives the net. Null when there is no income — either the month
  // had only expenses (treated as −∞%) or no activity at all (displayed as —).
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
                    : '—'}
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
                {creditUtilization}%
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
                      width: `${Math.max(0, Math.min(creditUtilization, 100))}%`,
                    }}
                  />
                </div>
                <p
                  className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
                  style={{ color: 'var(--app-text-subtle)' }}
                >
                  {formatCurrency(totalCreditUsed, displayCurrency)} of{' '}
                  {formatCurrency(totalCreditLimit, displayCurrency)}
                </p>
              </div>
            </div>

            {/* Cash Runway — placeholder until transactions API is wired */}
            <div className="pl-6">
              <div className="h-20 bg-gray-300 rounded-lg" />
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

        {/* Debts section */}
        <section>
          {/* Editorial header — title ─── subtotal */}
          <div className="flex items-center gap-4 mb-2">
            <h3
              className="font-serif font-semibold shrink-0 text-2xl"
              style={{ color: 'var(--app-negative)' }}
            >
              Liabilities
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
              style={{ color: totalDebts < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
            >
              {formatCurrency(totalDebts, displayCurrency)}
            </span>
          </div>

          {/* Rows */}
          <div>
            {debtRows.length === 0 ? (
              <p
                className="py-3 text-center italic text-sm"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                No liability accounts
              </p>
            ) : (
              debtRows.map((account) => (
                <div key={account.id} className="flex items-stretch rounded-xl">
                  <div
                    className="w-0.5 rounded-full my-3"
                    style={{ background: 'var(--app-negative)', opacity: 0.3 }}
                  />
                  <div className="flex-1 flex items-center gap-4 py-3.5 px-4">
                    <InstitutionLogo institution={account.institution} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{account.name}</p>
                      <p
                        className="text-sm mt-0.5"
                        style={{ color: 'var(--app-text-muted)' }}
                      >
                        {account.institution?.name ?? 'Cash'} ·{' '}
                        {humanizeAccountType(account.account_type)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className="font-financial font-medium"
                        style={{
                          color:
                            account.current_balance < 0
                              ? 'var(--app-negative)'
                              : 'var(--app-text)',
                        }}
                      >
                        {formatCurrency(account.current_balance, displayCurrency)}
                      </p>
                      {account.credit_limit !== null && (
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
              ))
            )}
          </div>
        </section>

        {/* Assets section */}
        <section>
          {/* Editorial header — title ─── subtotal */}
          <div className="flex items-center gap-4 mb-2">
            <h3
              className="font-serif font-semibold shrink-0 text-2xl"
              style={{ color: 'var(--app-positive)' }}
            >
              Assets
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
              style={{ color: totalAssets >= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
            >
              {formatCurrency(totalAssets, displayCurrency)}
            </span>
          </div>

          {/* Rows */}
          <div>
            {assetRows.length === 0 ? (
              <p
                className="py-3 text-center italic text-sm"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                No asset accounts
              </p>
            ) : (
              assetRows.map((account) => (
                <div key={account.id} className="flex items-stretch rounded-xl">
                  <div
                    className="w-0.5 rounded-full my-3"
                    style={{ background: 'var(--app-positive)', opacity: 0.3 }}
                  />
                  <div className="flex-1 flex items-center gap-4 py-3.5 px-4">
                    <InstitutionLogo institution={account.institution} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{account.name}</p>
                      <p
                        className="text-sm mt-0.5"
                        style={{ color: 'var(--app-text-muted)' }}
                      >
                        {account.institution?.name ?? 'Cash'} ·{' '}
                        {humanizeAccountType(account.account_type)}
                      </p>
                    </div>
                    <p
                      className="font-financial font-medium shrink-0"
                      style={{
                        color:
                          account.current_balance > 0
                            ? 'var(--app-positive)'
                            : account.current_balance < 0
                              ? 'var(--app-negative)'
                              : 'var(--app-text)',
                      }}
                    >
                      {formatCurrency(account.current_balance, displayCurrency)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

      </div>

      <CreateAccountModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  )
}
