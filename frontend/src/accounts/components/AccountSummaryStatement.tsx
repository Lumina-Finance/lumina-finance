import { formatCurrency } from '@/utils/formatCurrency'
import type { FxStatus } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'

function getAccountSummaryFxStatusMessage(fxStatus: FxStatus) {
  switch (fxStatus.state) {
    case 'none':
      return 'All account balances were already in your base currency'
    case 'complete':
      return 'Foreign currency account balances were converted into your base currency'
    case 'incomplete':
      return 'Some foreign currency accounts could not be converted. Account totals are incomplete and only include accounts with available conversion rates'
    case 'unavailable':
      return 'Foreign currency accounts could not be converted. Account totals are incomplete and only include base currency accounts'
  }
}

export default function AccountSummaryStatement({
  error,
  isLoading,
  netWorth,
  totalAssets,
  totalDebts,
  assetCount,
  debtCount,
  displayCurrency,
  fxStatus,
}: {
  error: unknown
  isLoading: boolean
  netWorth: number
  totalAssets: number
  totalDebts: number
  assetCount: number
  debtCount: number
  displayCurrency: string
  fxStatus: FxStatus
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
          <div className="mb-1.5 flex items-center gap-2">
            <p className="app-label">Net Worth</p>
            <IconTooltip
              label="Net worth FX status"
              icon="fx"
              fxTone={getFxStatusTone(fxStatus)}
              placement="top"
            >
              <span className="block">{getAccountSummaryFxStatusMessage(fxStatus)}</span>
              {fxStatus.missing_pairs.length > 0 && (
                <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
                </span>
              )}
            </IconTooltip>
          </div>
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
