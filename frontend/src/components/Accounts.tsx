import { useAccounts, type AccountsOverview } from '@/api/accounts'

// Format an integer amount in a currency's minor units (e.g. cents) as a
// localized currency string. Intl.NumberFormat knows the exponent for each
// ISO 4217 code, so we divide by 10^exponent before formatting.
function formatCurrency(minorUnits: number, currency: string): string {
  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const exponent = fmt.resolvedOptions().maximumFractionDigits ?? 2
  return fmt.format(minorUnits / Math.pow(10, exponent))
}

function sumByKind(accounts: AccountsOverview[], kind: 'asset' | 'liability'): number {
  return accounts
    .filter((a) => a.account_kind === kind)
    .reduce((sum, a) => sum + a.current_balance, 0)
}

export default function Accounts() {
  const { data: accounts, isLoading, error } = useAccounts()

  const rows = accounts ?? []
  const totalAssets = sumByKind(rows, 'asset')
  const totalDebts = sumByKind(rows, 'liability')
  const netWorth = totalAssets - totalDebts
  const assetCount = rows.filter((a) => a.account_kind === 'asset').length
  const debtCount = rows.filter((a) => a.account_kind === 'liability').length

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
        <div className="flex flex-wrap gap-4">
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
          <div className="rounded-lg h-[3.25rem] w-40 bg-gray-300" />
        </div>

        {/* Debts section */}
        <section className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="h-7 w-24 rounded bg-gray-300" />
            <div className="flex-1 h-px bg-gray-300" />
            <div className="h-7 w-32 rounded bg-gray-300" />
          </div>
          <div className="space-y-2">
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
          </div>
        </section>

        {/* Assets section */}
        <section className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="h-7 w-24 rounded bg-gray-300" />
            <div className="flex-1 h-px bg-gray-300" />
            <div className="h-7 w-32 rounded bg-gray-300" />
          </div>
          <div className="space-y-2">
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
            <div className="rounded-xl h-16 bg-gray-300" />
          </div>
        </section>

        {/* Add New Account button */}
        <div className="rounded-xl h-12 bg-gray-300" />
      </div>
    </div>
  )
}
