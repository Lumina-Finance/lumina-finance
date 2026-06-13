import { useMemo } from 'react'
import { Store } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import type { MerchantMarketMerchant } from '@/insights/types/merchantDistribution'
import { getMerchantSpendingFxStatusMessage } from '@/insights/utils/fxTooltipMessages'
import { FxStatusBadge } from '../FxStatusBadge'
import { InsightCalculationTooltip } from '../InsightCalculationTooltip'
import { MerchantDistributionLegend } from './MerchantDistributionLegend'
import { MerchantMarketMap } from './MerchantMarketMap'
import { SectionHeader } from '../SectionHeader'

type MerchantDistributionCardProps = {
  merchants: MerchantMarketMerchant[]
  fxStatus: FxStatus | undefined
  currency: string
  loading?: boolean
  transitionKey: string
}

type MerchantDistributionSnapshot = {
  merchants: MerchantMarketMerchant[]
  fxStatus: FxStatus | undefined
  currency: string
  emptyLabel: string
}

/**
 * Renders merchant distribution totals and the merchant market map
 */
export function MerchantDistributionCard({
  merchants,
  fxStatus,
  currency,
  loading = false,
  transitionKey,
}: MerchantDistributionCardProps) {
  const incomingSnapshot = useMemo<MerchantDistributionSnapshot>(() => ({
    merchants,
    fxStatus,
    currency,
    emptyLabel: loading ? 'Loading merchant spending...' : 'No merchant spending in this range',
  }), [currency, fxStatus, loading, merchants])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<MerchantDistributionSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })

  return (
    <div className="app-card flex h-[560px] flex-col min-[1300px]:h-full">
      <SectionHeader
        icon={Store}
        label={(
          <span className="inline-flex items-center gap-2">
            Spending Distribution by Merchant
            <InsightCalculationTooltip
              label="Merchant Distribution"
              calculation="Shows merchant spending after refunds. Income losses are not included"
            />
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Merchant Distribution FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getMerchantSpendingFxStatusMessage}
              />
            )}
          </span>
        )}
      />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <LoadingContent
          className="flex min-h-0 flex-1 flex-col"
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
        >
          {displaySnapshot.merchants.length > 0 ? (
            <MerchantMarketMap merchants={displaySnapshot.merchants} currency={displaySnapshot.currency} />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] text-sm" style={{ color: 'var(--app-text-muted)' }}>
              {displaySnapshot.emptyLabel}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--app-text-muted)' }}>
            <span>Tile size shows total spend. Dots mark tiny tiles with details available on hover</span>
            <MerchantDistributionLegend />
          </div>
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading merchant spending distribution"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </div>
  )
}
