import { formatCurrency } from '@/utils/formatCurrency'

export default function AccountSummaryStatement({
  error,
  isLoading,
  netWorth,
  totalAssets,
  totalDebts,
  assetCount,
  debtCount,
  displayCurrency,
}: {
  error: unknown
  isLoading: boolean
  netWorth: number
  totalAssets: number
  totalDebts: number
  assetCount: number
  debtCount: number
  displayCurrency: string
}) {
  if (error) {
    return (
      <p className="py-2 font-medium" style={{ color: 'var(--app-negative)' }}>
        Unable to load accounts.
      </p>
    )
  }

  if (isLoading) return null

  return (
    <section>
      <div
        className="mb-5"
        style={{
          height: 1,
          background:
            'linear-gradient(to right, var(--app-accent), var(--app-accent-border), transparent)',
        }}
      />
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="app-label mb-1.5">Net Worth</p>
          <p
            className="font-financial text-[3.375rem] font-semibold leading-none tracking-tight"
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
              className="font-financial text-xl font-medium"
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
              className="font-financial text-xl font-medium"
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
  )
}
