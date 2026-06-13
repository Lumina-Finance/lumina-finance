import { BarChart3 } from 'lucide-react'
import type { SpendingRange } from '@/api/dashboard'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import IconTooltip from '@/components/IconTooltip'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import {
  DASHBOARD_RANGE_SELECT_OPTIONS,
  PREVIOUS_PERIOD_LABEL_BY_RANGE,
} from '@/dashboard/constants/ranges'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getSpendingComparisonFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'

type SpendingComparisonHeaderProps = {
  spendingRange: SpendingRange
  fxStatus: FxStatus | undefined
  onRangeChange: (range: SpendingRange) => void
}

/**
 * Renders the spending comparison title, FX status, and responsive range controls
 */
export function SpendingComparisonHeader({
  spendingRange,
  fxStatus,
  onRangeChange,
}: SpendingComparisonHeaderProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
        <BarChart3 size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
      </div>
      <span className="app-label inline-flex items-baseline whitespace-nowrap">
        Spending vs. Last&nbsp;
        <AppSlotMachineText text={PREVIOUS_PERIOD_LABEL_BY_RANGE[spendingRange]} />
      </span>
      {fxStatus && (
        <IconTooltip
          label="Spending comparison FX status"
          icon="fx"
          fxTone={getFxStatusTone(fxStatus)}
          placement="top"
        >
          <span className="block">{getSpendingComparisonFxStatusMessage(fxStatus)}</span>
          {fxStatus.missing_pairs.length > 0 && (
            <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
            </span>
          )}
        </IconTooltip>
      )}
      <TimeRangeSelector
        value={spendingRange}
        options={DASHBOARD_RANGE_SELECT_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Spending range"
        className="ml-auto hidden min-[730px]:inline-flex"
      />
      <TimeRangeSelector
        value={spendingRange}
        options={DASHBOARD_RANGE_SELECT_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Spending range"
        variant="mobile"
        className="w-full min-[730px]:hidden"
        sheetTitle="Spending range"
      />
    </div>
  )
}
