import { useMemo } from 'react'
import { Wallet } from 'lucide-react'
import { useDashboardNetWorth } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { NetWorthChart } from '@/dashboard/components/NetWorthChart'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getNetWorthFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getNetWorthSeries } from '@/dashboard/utils/getNetWorthSeries'

type NetWorthWidgetProps = {
  displayCurrency: string
}

/**
 * Formats dashboard net worth movement with an explicit positive or negative sign
 */
function formatNetWorthChange(amount: number, currency: string) {
  if (amount === 0) return formatDashboardMoney(0, currency, 'netWorth')
  return `${amount > 0 ? '+' : '-'}${formatDashboardMoney(Math.abs(amount), currency, 'netWorth')}`
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
  const netWorthColor = netWorth < 0 ? 'var(--app-negative)' : 'var(--app-text)'
  const netWorthChangeColor =
    netWorthChange == null || netWorthChange === 0
      ? 'var(--app-text-muted)'
      : netWorthChange > 0
        ? 'var(--app-positive)'
        : 'var(--app-negative)'

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
        <div className="inline-flex max-w-full items-end gap-2">
          <p
            className="min-w-0 font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]"
            style={{ color: netWorthColor }}
          >
            {formatDashboardMoney(netWorth, displayCurrency, 'netWorth')}
          </p>
          {netWorthChange != null && (
            <p
              className="shrink-0 pb-0.5 font-financial text-sm font-medium leading-none max-[1000px]:text-xs"
              style={{ color: netWorthChangeColor }}
              aria-label={`Net worth change ${formatNetWorthChange(netWorthChange, displayCurrency)}`}
            >
              {formatNetWorthChange(netWorthChange, displayCurrency)}
            </p>
          )}
        </div>
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
