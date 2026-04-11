import { Plus } from 'lucide-react'
import { useAccounts, type AccountsOverview } from '@/api/accounts'

// Format an integer amount in a currency's minor units (e.g. cents) as a
// localized currency string. Intl.NumberFormat knows the exponent for each
// ISO 4217 code, so we divide by 10^exponent before formatting.
// currencySign: 'accounting' renders negatives in parentheses — e.g. -100 → ($100.00).
function formatCurrency(minorUnits: number, currency: string): string {
  const fmt = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
  })
  const exponent = fmt.resolvedOptions().maximumFractionDigits ?? 2
  return fmt.format(minorUnits / Math.pow(10, exponent))
}

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
  const { data: accounts, isLoading, error } = useAccounts()

  const rows = accounts ?? []
  const totalAssets = sumByKind(rows, 'asset')
  const totalDebts = sumByKind(rows, 'liability')
  const netWorth = totalAssets - totalDebts
  const assetCount = rows.filter((a) => a.account_kind === 'asset').length
  const debtCount = rows.filter((a) => a.account_kind === 'liability').length

  // Debts ordered by balance descending — largest liability surfaces first.
  const debtRows = rows
    .filter((a) => a.account_kind === 'liability')
    .sort((a, b) => b.current_balance - a.current_balance)

  // Assets ordered by balance descending — largest holding surfaces first.
  const assetRows = rows
    .filter((a) => a.account_kind === 'asset')
    .sort((a, b) => b.current_balance - a.current_balance)

  // Credit usage — aggregate over liability accounts that have a credit_limit set.
  // Loan-style liabilities (mortgages, term loans) have no limit and are excluded.
  const creditAccounts = rows.filter(
    (a) => a.account_kind === 'liability' && a.credit_limit !== null,
  )
  const totalCreditUsed = creditAccounts.reduce((sum, a) => sum + a.current_balance, 0)
  const totalCreditLimit = creditAccounts.reduce((sum, a) => sum + (a.credit_limit ?? 0), 0)
  const creditUtilization =
    totalCreditLimit > 0 ? Math.round((totalCreditUsed / totalCreditLimit) * 100) : 0
  const creditUtilColor =
    creditUtilization <= 30
      ? 'var(--app-positive)'
      : creditUtilization <= 70
        ? 'var(--app-accent)'
        : 'var(--app-negative)'
  // Use the first account's currency as a display hint until a user
  // base-currency is wired through the auth response.
  const displayCurrency = rows[0]?.currency ?? 'USD'

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
                  className="font-financial font-semibold tracking-tight leading-none text-6xl"
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
                    style={{ color: 'var(--app-positive)' }}
                  >
                    {formatCurrency(totalAssets, displayCurrency)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                    {assetCount} account{assetCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="app-label mb-0.5">Debts</p>
                  <p
                    className="font-financial font-medium text-xl"
                    style={{ color: 'var(--app-negative)' }}
                  >
                    {formatCurrency(totalDebts, displayCurrency)}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
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
            {/* Savings Rate — placeholder until transactions API is wired */}
            <div className="pr-6">
              <div className="h-20 bg-gray-300 rounded-lg" />
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
                      width: `${Math.min(creditUtilization, 100)}%`,
                    }}
                  />
                </div>
                <p
                  className="font-financial text-[clamp(0.625rem,0.7vw,0.6875rem)]"
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

        {/* Filter row — institution / category / type / tax advantaged */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <button type="button" className="app-secondary-button ml-auto">
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
              Debts
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
              style={{ color: 'var(--app-negative)' }}
            >
              {formatCurrency(-totalDebts, displayCurrency)}
            </span>
          </div>

          {/* Rows */}
          <div>
            {debtRows.length === 0 ? (
              <p
                className="py-3 text-center italic text-sm"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                No debt accounts
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
                    <p
                      className="font-financial font-medium shrink-0"
                      style={{ color: 'var(--app-negative)' }}
                    >
                      {formatCurrency(-account.current_balance, displayCurrency)}
                    </p>
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
              style={{ color: 'var(--app-positive)' }}
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
                    <p className="font-financial font-medium shrink-0">
                      {formatCurrency(account.current_balance, displayCurrency)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
