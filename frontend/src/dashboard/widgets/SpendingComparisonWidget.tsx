import { useMemo, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react'
import {
  type SpendingRange,
  useSpendingComparison,
} from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import IconTooltip from '@/components/IconTooltip'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { SpendingComparisonChart } from '@/dashboard/components/SpendingComparisonChart'
import {
  CURRENT_LABEL_BY_RANGE,
  DASHBOARD_RANGE_SELECT_OPTIONS,
  PREVIOUS_LABEL_BY_RANGE,
  PREVIOUS_PERIOD_LABEL_BY_RANGE,
} from '@/dashboard/constants/ranges'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getSpendingComparisonFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getSpendingComparisonSummary } from '@/dashboard/utils/getSpendingComparisonSummary'

type SpendingComparisonWidgetProps = {
  displayCurrency: string
}

export function SpendingComparisonWidget({ displayCurrency }: SpendingComparisonWidgetProps) {
  const [spendingRange, setSpendingRange] = useState<SpendingRange>('MTD')
  const { data: incomingSpendingComparison, isFetching: spendingComparisonLoading } = useSpendingComparison(spendingRange)
  const loadingSnapshot = useMemo(
    () => ({
      spendingComparison: incomingSpendingComparison,
      spendingRange,
    }),
    [incomingSpendingComparison, spendingRange],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: spendingComparisonLoading,
    transitionKey: spendingRange,
  })
  const { spendingComparison, spendingRange: displaySpendingRange } = displaySnapshot
  const fxStatus = spendingComparison?.fx_status
  const {
    spendingChartData,
    spendingXAxisTicks,
    firstSpendingXAxisTick,
    lastSpendingXAxisTick,
    spendingPointsByLabel,
    currentHasData,
    previousHasData,
    spentToDate,
    spendingDeltaPct,
    spendingDeltaText,
  } = useMemo(
    () => getSpendingComparisonSummary(spendingComparison, displaySpendingRange),
    [displaySpendingRange, spendingComparison],
  )
  return (
    <div className="app-card h-[470px] flex flex-col">
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
          onChange={setSpendingRange}
          ariaLabel="Spending range"
          className="ml-auto hidden min-[730px]:inline-flex"
        />
        <TimeRangeSelector
          value={spendingRange}
          options={DASHBOARD_RANGE_SELECT_OPTIONS}
          onChange={setSpendingRange}
          ariaLabel="Spending range"
          variant="mobile"
          className="w-full min-[730px]:hidden"
          sheetTitle="Spending range"
        />
      </div>
      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading spending comparison"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        <div className="flex items-baseline gap-2">
          <p className="font-financial text-3xl font-normal leading-none tracking-tight max-[1000px]:text-[1.6875rem]">
            <AppScrambledNumber text={formatCurrency(spentToDate, displayCurrency)} />
          </p>
          {spendingDeltaPct != null && (
            <div
              className="flex items-center text-sm font-medium max-[1000px]:text-[0.7875rem]"
              style={{ color: spendingDeltaPct <= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
            >
              {spendingDeltaPct <= 0 ? (
                <ArrowDownRight size={14} aria-hidden />
              ) : (
                <ArrowUpRight size={14} aria-hidden />
              )}
              <AppScrambledNumber text={spendingDeltaText} />
            </div>
          )}
        </div>
        <div className="mb-2 mt-2 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: 'var(--app-accent)',
                opacity: currentHasData ? 1 : 0.4,
              }}
            />
            <span
              className="text-xs max-[1000px]:text-[0.675rem]"
              style={{
                color: 'var(--app-text-muted)',
                fontStyle: currentHasData ? 'normal' : 'italic',
              }}
            >
              {currentHasData
                ? CURRENT_LABEL_BY_RANGE[displaySpendingRange]
                : `No data for ${CURRENT_LABEL_BY_RANGE[displaySpendingRange].toLowerCase()}`}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{
                background: 'var(--app-text-muted)',
                opacity: previousHasData ? 1 : 0.4,
              }}
            />
            <span
              className="text-xs max-[1000px]:text-[0.675rem]"
              style={{
                color: 'var(--app-text-muted)',
                fontStyle: previousHasData ? 'normal' : 'italic',
              }}
            >
              {previousHasData
                ? PREVIOUS_LABEL_BY_RANGE[displaySpendingRange]
                : `No data for ${PREVIOUS_LABEL_BY_RANGE[displaySpendingRange].toLowerCase()}`}
            </span>
          </div>
        </div>
        <SpendingComparisonChart
          data={spendingChartData}
          pointsByLabel={spendingPointsByLabel}
          xAxisTicks={spendingXAxisTicks}
          firstXAxisTick={firstSpendingXAxisTick}
          lastXAxisTick={lastSpendingXAxisTick}
          displayCurrency={displayCurrency}
          spendingRange={displaySpendingRange}
        />
      </DashboardWidgetLoadingBody>
    </div>
  )
}
