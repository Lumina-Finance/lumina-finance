import { useMemo, useState } from 'react'
import { useAccountSnapshots, type Account } from '@/api/accounts'
import {
  LoadingContent,
  LoadingOverlay,
} from '@/components/LoadingTransition'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import type {
  BalanceChartMode,
  BalanceRange,
} from '@/pages/accounts/detail/constants/accountDetail'
import {
  getBalanceChartSnapshot,
  getBalanceRangeWindow,
  type BalanceChartSnapshot,
} from '@/pages/accounts/detail/utils/balanceChartViewModel'
import { toISODate } from '@/pages/accounts/detail/utils/date'
import { BalanceChart } from './BalanceChart'
import { BalanceChartHeader } from './BalanceChartHeader'
import { BalanceValueSummary } from './BalanceValueSummary'

/**
 * Renders the account balance chart card and owns snapshot fetching for selected chart controls
 */
export default function BalanceChartCard({ account }: { account: Account }) {
  const [range, setRange] = useState<BalanceRange>('30D')
  const [chartMode, setChartMode] = useState<BalanceChartMode>('balance')

  const { fromDate, toDate, granularity } = useMemo(
    () => getBalanceRangeWindow(range),
    [range],
  )

  const { data: snapshots, isFetching } = useAccountSnapshots(account.id, {
    fromDate: toISODate(fromDate),
    toDate: toISODate(toDate),
    granularity: 'day',
    includeAnchor: true,
  })

  const incomingSnapshot = useMemo<BalanceChartSnapshot>(() => ({
    ...getBalanceChartSnapshot({
      snapshots: snapshots ?? [],
      range,
      chartMode,
      currentBalance: account.current_balance,
      currency: account.currency,
      fromDate,
      toDate,
      granularity,
    }),
  }), [
    account.currency,
    account.current_balance,
    chartMode,
    fromDate,
    granularity,
    range,
    snapshots,
    toDate,
  ])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot<BalanceChartSnapshot>({
    snapshot: incomingSnapshot,
    loading: isFetching,
    transitionKey: range,
  })

  return (
    <section className="app-card flex flex-col">
      <BalanceChartHeader
        range={range}
        chartMode={chartMode}
        onRangeChange={setRange}
        onChartModeChange={setChartMode}
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <LoadingContent
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
          className="flex min-h-0 flex-1 flex-col"
        >
          <BalanceValueSummary snapshot={displaySnapshot} />
          <BalanceChart accountId={account.id} snapshot={displaySnapshot} />
        </LoadingContent>

        <LoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading current balance"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
