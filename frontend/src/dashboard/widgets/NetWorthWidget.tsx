import { useMemo } from 'react'
import { Wallet } from 'lucide-react'
import { useDashboardNetWorth } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { NetWorthChart } from '@/dashboard/components/NetWorthChart'
import { NetWorthMetric } from '@/dashboard/components/NetWorthMetric'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getNetWorthFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getNetWorthSeries } from '@/dashboard/utils/getNetWorthSeries'

type NetWorthWidgetProps = {
  displayCurrency: string
}

/**
 * Loads net worth data and composes the summary metric, FX status, and trend chart
 */
export function NetWorthWidget({ displayCurrency }: NetWorthWidgetProps) {
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
    () => getNetWorthSeries(dashboardNetWorth),
    [dashboardNetWorth],
  )
  const netWorth = dashboardNetWorth?.current_net_worth ?? 0
  const netWorthChange = netWorthData.length >= 2 ? netWorth - netWorthData[0].value : null
  const fxStatus = dashboardNetWorth?.fx_status
  const fxTone = getFxStatusTone(fxStatus)

  return (
    <div className="app-card h-[14rem] pb-2 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <Wallet size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Net Worth</span>
        {fxStatus && (
          <IconTooltip
            label="Net worth FX status"
            icon="fx"
            fxTone={fxTone}
            placement="top"
          >
            <span className="block">{getNetWorthFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
      </div>
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
