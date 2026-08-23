import { useMemo } from 'react'
import { ListChecks } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import LoadFailure from '@/components/errors/LoadFailure'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/loading/Transition'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import type { MerchantRankingRow } from '@/pages/insights/types/merchantRanking'
import { getMerchantSpendingFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { InsightCalculationTooltip } from '@/pages/insights/components/CalculationTooltip'
import { InsightSectionHeader } from '@/pages/insights/components/SectionHeader'

type MerchantRankingCardProps = {
  merchants: MerchantRankingRow[]
  fxStatus: FxStatus | undefined
  currency: string

  /** The rejection this card's request reported */
  error: unknown

  failed: boolean

  loading?: boolean
  transitionKey: string
}

type MerchantRankingSnapshot = {
  merchants: MerchantRankingRow[]
  fxStatus: FxStatus | undefined
  currency: string
  emptyLabel: string
  error: unknown
  failed: boolean
}

function getChangeColor(changePct: number | null) {
  if (changePct === null) return 'var(--app-text-muted)'
  if (changePct > 0) return 'var(--app-chart-negative)'
  if (changePct < 0) return 'var(--app-chart-positive)'
  return 'var(--app-text-muted)'
}

function getChangeLabel(changePct: number | null) {
  if (changePct === null) return 'New'
  return `${changePct > 0 ? '+' : ''}${changePct}%`
}

/**
 * Renders the merchant ranking card, listing the top merchants by spending after refunds along
 * with their change against the comparison period
 */
export function MerchantRankingCard({
  merchants,
  fxStatus,
  currency,
  error,
  failed,
  loading = false,
  transitionKey,
}: MerchantRankingCardProps) {
  const { formatCurrency } = useMoneyFormatters()
  // The failure travels in the snapshot rather than beside it, so the box arrives with the reveal
  // instead of replacing the list while the spinner is still turning
  const incomingSnapshot = useMemo<MerchantRankingSnapshot>(() => ({
    merchants,
    fxStatus,
    currency,
    emptyLabel: loading ? 'Loading merchant ranking...' : 'No merchant spending in this range',
    error,
    failed,
  }), [currency, error, failed, fxStatus, loading, merchants])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<MerchantRankingSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })

  // The box takes the place of the ranking, so the body has to fill the card's height for the box
  // to have a middle to sit in. Content-sized, it would sit at the top of a card still holding
  // 560px above 1300px, with the rest of that height empty beneath it. The ranking's own layout is
  // left alone, since it sizes to its rows
  const boxAlone = displaySnapshot.failed

  return (
    <div className="app-card flex flex-col min-[1300px]:h-[560px]">
      <InsightSectionHeader
        icon={ListChecks}
        label={(
          <span className="inline-flex items-center gap-2">
            Merchant Ranking
            <InsightCalculationTooltip
              label="Merchant Ranking"
              calculation="Ranks merchants by spending after refunds. Income losses are not included"
            />
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Merchant Ranking FX status"
                fxStatus={displaySnapshot.fxStatus}
                getMessage={getMerchantSpendingFxStatusMessage}
              />
            )}
          </span>
        )}
      />
      <div className={`relative overflow-hidden ${boxAlone ? 'flex min-h-0 flex-1 flex-col' : ''}`}>
        <LoadingContent
          className={boxAlone ? 'flex min-h-0 flex-1 flex-col' : undefined}
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
        >
          {displaySnapshot.failed && (
            <LoadFailure
              error={displaySnapshot.error}
              standalone
              subject="Merchant ranking"
            />
          )}

          {!displaySnapshot.failed && (
            displaySnapshot.merchants.length > 0 ? (
              <div className="space-y-3">
                {displaySnapshot.merchants.map((merchant, index) => (
                  <div key={merchant.id} className="flex items-center gap-3">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                      style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {merchant.name}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
                        {merchant.transactionCount} transactions | avg {formatCurrency(merchant.averageAmount, displaySnapshot.currency)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-financial text-sm">
                        {formatCurrency(merchant.totalAmount, displaySnapshot.currency)}
                      </p>
                      <p
                        className="font-financial text-xs"
                        style={{ color: getChangeColor(merchant.changePct) }}
                      >
                        {getChangeLabel(merchant.changePct)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {displaySnapshot.emptyLabel}
              </div>
            )
          )}
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading merchant ranking"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </div>
  )
}
