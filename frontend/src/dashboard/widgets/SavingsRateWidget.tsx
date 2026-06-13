import { useMemo, useState } from 'react'
import { ArrowUpToLine, Repeat } from 'lucide-react'
import { useDashboardSavingsRate } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { SavingsRateChart } from '@/dashboard/components/SavingsRateChart'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getSavingsRateFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getSavingsRateChartData } from '@/dashboard/utils/getSavingsRateChartData'
import { getSavingsRateSeries } from '@/dashboard/utils/getSavingsRateSeries'

/**
 * Loads savings rate data and composes the chart, FX status, and capped display toggle
 */
export function SavingsRateWidget() {
  const [capSavingsRateChart, setCapSavingsRateChart] = useState(false)
  const { data: incomingDashboardSavingsRate, isFetching: dashboardSavingsRateLoading } = useDashboardSavingsRate()
  const loadingSnapshot = useMemo(
    () => ({ dashboardSavingsRate: incomingDashboardSavingsRate }),
    [incomingDashboardSavingsRate],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: dashboardSavingsRateLoading,
    transitionKey: 'savings-rate',
  })
  const dashboardSavingsRate = displaySnapshot.dashboardSavingsRate
  const fxStatus = dashboardSavingsRate?.fx_status
  const savingsData = useMemo(
    () => getSavingsRateSeries(dashboardSavingsRate),
    [dashboardSavingsRate],
  )
  const chartData = useMemo(
    () => getSavingsRateChartData(savingsData, capSavingsRateChart),
    [capSavingsRateChart, savingsData],
  )

  return (
    <div className="app-card h-[14rem] pb-2 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <Repeat size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Savings Rate</span>
        {fxStatus && (
          <IconTooltip
            label="Savings rate FX status"
            icon="fx"
            fxTone={getFxStatusTone(fxStatus)}
            placement="top"
          >
            <span className="block">{getSavingsRateFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
        <button
          type="button"
          onClick={() => setCapSavingsRateChart((current) => !current)}
          title={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
          aria-label={capSavingsRateChart ? 'Show uncapped savings rate chart' : 'Cap savings rate chart at plus or minus 100%'}
          className="app-icon-button ml-auto"
        >
          <ArrowUpToLine
            size={12}
            className={`transition-transform duration-150 motion-reduce:transition-none ${capSavingsRateChart ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading savings rate"
        className="flex-1"
      >
        <SavingsRateChart
          data={chartData}
          capSavingsRateChart={capSavingsRateChart}
        />
      </DashboardWidgetLoadingBody>
    </div>
  )
}
