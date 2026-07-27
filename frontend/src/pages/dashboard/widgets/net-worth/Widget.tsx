import { useMemo } from 'react'
import { useDashboardNetWorth } from '@/api/dashboard'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import { NetWorthChart } from './Chart'
import { NetWorthHeader } from './Header'
import { NetWorthMetric } from './Metric'
import { getNetWorthSeries } from '@/pages/dashboard/utils/getNetWorthSeries'
import { useAuth } from '@/hooks/useAuth'

type NetWorthWidgetProps = {
  displayCurrency: string
}

/**
 * Loads net worth data and composes the summary metric, FX status, and trend chart
 */
export function NetWorthWidget({ displayCurrency }: NetWorthWidgetProps) {
  const { user } = useAuth()
  const { data: incomingDashboardNetWorth, isFetching: dashboardNetWorthLoading } = useDashboardNetWorth()
  const loadingSnapshot = useMemo(
    () => ({ dashboardNetWorth: incomingDashboardNetWorth }),
    [incomingDashboardNetWorth],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: dashboardNetWorthLoading,
    transitionKey: 'net-worth',
  })
  const dashboardNetWorth = displaySnapshot.dashboardNetWorth
  const netWorthData = useMemo(
    () => getNetWorthSeries(dashboardNetWorth, user?.tz),
    [dashboardNetWorth, user?.tz],
  )
  const netWorth = dashboardNetWorth?.current_net_worth ?? 0
  const netWorthChange = netWorthData.length >= 2 ? netWorth - netWorthData[0].value : null
  const fxStatus = dashboardNetWorth?.fx_status

  return (
    <div className="app-card h-[14rem] pb-2 flex flex-col">
      <NetWorthHeader fxStatus={fxStatus} />
      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading net worth"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        <NetWorthMetric
          netWorth={netWorth}
          netWorthChange={netWorthChange}
          displayCurrency={displayCurrency}
        />
        {netWorthData.length >= 2 && (
          <NetWorthChart
            data={netWorthData}
            displayCurrency={displayCurrency}
          />
        )}
      </DashboardWidgetLoadingBody>
    </div>
  )
}
