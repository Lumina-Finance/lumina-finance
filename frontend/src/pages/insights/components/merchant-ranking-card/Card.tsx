import { useMemo } from 'react'
import { ListChecks } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
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
  loading?: boolean
  transitionKey: string
}

type MerchantRankingSnapshot = {
  merchants: MerchantRankingRow[]
  fxStatus: FxStatus | undefined
  currency: string
  emptyLabel: string
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
  loading = false,
  transitionKey,
}: MerchantRankingCardProps) {
  const { formatCurrency } = useMoneyFormatters()
  const incomingSnapshot = useMemo<MerchantRankingSnapshot>(() => ({
    merchants,
    fxStatus,
    currency,
    emptyLabel: loading ? 'Loading merchant ranking...' : 'No merchant spending in this range',
  }), [currency, fxStatus, loading, merchants])
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

  return (
    <div className="app-card min-[1300px]:h-[560px]">
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
      <div className="relative overflow-hidden">
        <LoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          {displaySnapshot.merchants.length > 0 ? (
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
