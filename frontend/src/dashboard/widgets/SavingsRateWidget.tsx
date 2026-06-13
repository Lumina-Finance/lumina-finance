import { useMemo, useState } from 'react'
import { useDashboardSavingsRate } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { SavingsRateChart } from '@/dashboard/components/SavingsRateChart'
import { SavingsRateHeader } from '@/dashboard/components/SavingsRateHeader'
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
      <SavingsRateHeader
        fxStatus={fxStatus}
        capSavingsRateChart={capSavingsRateChart}
        onCapToggle={() => setCapSavingsRateChart((current) => !current)}
      />
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
