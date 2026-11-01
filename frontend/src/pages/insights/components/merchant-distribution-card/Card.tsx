import { useMemo } from 'react'
import { Store } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import LoadFailure from '@/components/errors/LoadFailure'
import { LoadingContent, LoadingOverlay } from '@/components/loading/Transition'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import type { MerchantMarketMerchant } from '@/pages/insights/types/merchantDistribution'
import { getMerchantSpendingFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { InsightCalculationTooltip } from '@/pages/insights/components/CalculationTooltip'
import type { OptionItem } from '@/components/filters/OptionList'
import { MerchantCategoryFilter } from './CategoryFilter'
import { MerchantDistributionLegend } from './Legend'
import { MerchantMarketMap } from './MarketMap'
import { InsightSectionHeader } from '@/pages/insights/components/SectionHeader'

type MerchantDistributionCardProps = {
  merchants: MerchantMarketMerchant[]
  fxStatus: FxStatus | undefined
  currency: string

  /** The rejection this card's request reported */
  error: unknown

  failed: boolean

  loading?: boolean
  transitionKey: string
  categoryOptions: OptionItem[]
  selectedCategoryIds: string[]
  onCategoryIdsChange: (categoryIds: string[]) => void
}

type MerchantDistributionSnapshot = {
  merchants: MerchantMarketMerchant[]
  fxStatus: FxStatus | undefined
  currency: string
  emptyLabel: string
  error: unknown
  failed: boolean
}

/**
 * Renders merchant distribution totals and the merchant market map
 */
export function MerchantDistributionCard({
  merchants,
  fxStatus,
  currency,
  error,
  failed,
  loading = false,
  transitionKey,
  categoryOptions,
  selectedCategoryIds,
  onCategoryIdsChange,
}: MerchantDistributionCardProps) {
  const isFiltered = selectedCategoryIds.length > 0
  // The failure travels in the snapshot rather than beside it, so the box arrives with the reveal
  // instead of replacing the map while the spinner is still turning
  const incomingSnapshot = useMemo<MerchantDistributionSnapshot>(
    () => ({
      merchants,
      fxStatus,
      currency,
      emptyLabel: loading
        ? 'Loading merchant spending...'
        : isFiltered
          ? 'No merchant spending in these categories in this range'
          : 'No merchant spending in this range',
      error,
      failed,
    }),
    [currency, error, failed, fxStatus, isFiltered, loading, merchants],
  )
  const { displaySnapshot, contentConcealed, loadingVisible, shouldReduceMotion } =
    useLoadingSnapshot<MerchantDistributionSnapshot>({
      snapshot: incomingSnapshot,
      loading,
      transitionKey,
    })

  return (
    <div className="app-card flex h-[560px] flex-col min-[1300px]:h-full">
      <InsightSectionHeader
        icon={Store}
        keepLabelBesideIcon
        label={
          // The title breaks into balanced lines, with the two icons kept together after its last word. Below the
          // wide layout the spacing is tight and the letters a little closer, so the title and both icons fit one
          // row beside the icon at 390px wide. The parts alone total 326px against 324px of room, so gaps alone fall short
          <span className="text-balance tracking-tight min-[750px]:tracking-normal">
            Spending distribution by merchant
            <span className="ml-1 inline-flex items-center gap-1 whitespace-nowrap align-middle min-[750px]:ml-2 min-[750px]:gap-2">
              <InsightCalculationTooltip
                label="Merchant distribution"
                calculation="Shows merchant spending after refunds. Income losses are not included"
              />
              {displaySnapshot.fxStatus && (
                <FxStatusBadge
                  label="Merchant distribution FX status"
                  fxStatus={displaySnapshot.fxStatus}
                  getMessage={getMerchantSpendingFxStatusMessage}
                />
              )}
            </span>
          </span>
        }
        // Below the wide layout the filter takes its own full-width row under the title, as the dashboard's
        // range selector does
        actionClassName="w-full min-[750px]:ml-auto min-[750px]:w-auto"
        action={
          <MerchantCategoryFilter
            categoryOptions={categoryOptions}
            selectedIds={selectedCategoryIds}
            onChange={onCategoryIdsChange}
          />
        }
      />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <LoadingContent
          className="flex min-h-0 flex-1 flex-col"
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
        >
          {displaySnapshot.failed && (
            <LoadFailure compact error={displaySnapshot.error} standalone subject="Spending distribution by merchant" />
          )}

          {!displaySnapshot.failed && (
            <>
              {displaySnapshot.merchants.length > 0 ? (
                <MerchantMarketMap merchants={displaySnapshot.merchants} currency={displaySnapshot.currency} />
              ) : (
                <div
                  className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] px-4 text-center text-sm"
                  style={{ color: 'var(--app-text-muted)' }}
                >
                  {displaySnapshot.emptyLabel}
                </div>
              )}
              <div
                className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                style={{ color: 'var(--app-text-muted)' }}
              >
                <span>Tile size shows total spend. Dots mark tiny tiles with details available on hover</span>
                <MerchantDistributionLegend />
              </div>
            </>
          )}
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
