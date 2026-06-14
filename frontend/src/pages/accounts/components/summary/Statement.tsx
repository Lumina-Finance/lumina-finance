import { formatCurrency } from '@/utils/formatCurrency'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { getAccountSummaryFxStatusMessage } from '@/pages/accounts/utils/fxTooltipMessages'
import { SummaryValueFade } from './ValueFade'
import { SummaryValueSkeleton } from './ValueSkeleton'

type SummaryStatementProps = {
  error: unknown
  isLoading: boolean
  netWorth: number
  totalAssets: number
  totalDebts: number
  assetCount: number
  debtCount: number
  displayCurrency: string
  fxStatus: FxStatus
}

/**
 * Renders account totals, loading placeholders, and FX status for the accounts page summary
 */
export default function SummaryStatement({
  error,
  isLoading,
  netWorth,
  totalAssets,
  totalDebts,
  assetCount,
  debtCount,
  displayCurrency,
  fxStatus,
}: SummaryStatementProps) {
  if (error) {
    return (
      <p className="py-2 font-medium" style={{ color: 'var(--app-negative)' }}>
        Unable to load accounts.
      </p>
    )
  }

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
            <FxStatusBadge
              label="Net worth FX status"
              fxStatus={fxStatus}
              getMessage={getAccountSummaryFxStatusMessage}
            />
          </div>
          <SummaryValueFade
            loading={isLoading}
            skeleton={(
              <SummaryValueSkeleton
                label="Loading net worth value"
                className="h-[3.125rem] w-[min(18rem,76vw)] min-[730px]:h-[3.375rem]"
              />
            )}
          >
            <p
              className="font-financial text-[3.125rem] font-semibold leading-none tracking-tight min-[730px]:text-[3.375rem]"
              style={{
                color: netWorth >= 0 ? 'var(--app-positive)' : 'var(--app-negative)',
              }}
            >
              {formatCurrency(netWorth, displayCurrency)}
            </p>
          </SummaryValueFade>
        </div>

        <div className="grid grid-cols-2 gap-4 pb-1.5 min-[730px]:flex min-[730px]:gap-8">
          <div className="text-left min-[730px]:text-right">
            <p className="app-label mb-0.5">Assets</p>
            <SummaryValueFade
              loading={isLoading}
              skeleton={(
                <div className="grid w-max justify-items-start gap-1.5 min-[730px]:ml-auto min-[730px]:justify-items-end">
                  <SummaryValueSkeleton
                    label="Loading asset value"
                    className="h-6 w-28"
                  />
                  <SummaryValueSkeleton
                    label="Loading asset account count"
                    className="h-4 w-20"
                  />
                </div>
              )}
            >
              <>
                <p
                  className="font-financial text-xl font-medium"
                  style={{ color: totalAssets >= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
                >
                  {formatCurrency(totalAssets, displayCurrency)}
                </p>
                <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  {assetCount} account{assetCount !== 1 ? 's' : ''}
                </p>
              </>
            </SummaryValueFade>
          </div>
          <div className="text-right">
            <p className="app-label mb-0.5">Liabilities</p>
            <SummaryValueFade
              loading={isLoading}
              skeleton={(
                <div className="ml-auto grid w-max justify-items-end gap-1.5">
                  <SummaryValueSkeleton
                    label="Loading liability value"
                    className="h-6 w-28"
                  />
                  <SummaryValueSkeleton
                    label="Loading liability account count"
                    className="h-4 w-20"
                  />
                </div>
              )}
            >
              <>
                <p
                  className="font-financial text-xl font-medium"
                  style={{ color: totalDebts < 0 ? 'var(--app-negative)' : 'var(--app-text)' }}
                >
                  {formatCurrency(totalDebts, displayCurrency)}
                </p>
                <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  {debtCount} account{debtCount !== 1 ? 's' : ''}
                </p>
              </>
            </SummaryValueFade>
          </div>
        </div>
      </div>
    </section>
  )
}
