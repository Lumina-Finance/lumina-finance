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
        className="mb-3"
        style={{
          height: 1,
          background:
            'linear-gradient(to right, var(--app-accent), var(--app-accent-border), transparent)',
        }}
      />
      <div className="grid gap-5 min-[730px]:flex min-[730px]:flex-wrap min-[730px]:items-end min-[730px]:justify-between min-[730px]:gap-6">
        <div className="min-w-0">
          <p className="app-label mb-1.5">Net Worth</p>
          <p
            className="font-financial text-[3.125rem] font-semibold leading-none tracking-tight min-[730px]:text-[3.375rem]"
            style={{
              color: netWorth >= 0 ? 'var(--app-positive)' : 'var(--app-negative)',
            }}
          >
            {formatCurrency(netWorth, displayCurrency)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 pb-1.5 min-[730px]:flex min-[730px]:gap-8">
          <div className="text-left min-[730px]:text-right">
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
