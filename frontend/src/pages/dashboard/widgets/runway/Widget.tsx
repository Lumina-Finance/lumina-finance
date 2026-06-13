import { useMemo, useRef } from 'react'
import { useAccounts } from '@/api/accounts'
import { useRunway, useRunwayAccounts } from '@/api/user'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import {
  RUNWAY_BAND_STYLE,
  formatCompactRunway,
  runwayBand,
} from '@/utils/runway'
import { DashboardWidgetLoadingBody } from '@/pages/dashboard/components/WidgetLoadingBody'
import { RunwayHeader } from './Header'
import { RunwaySegmentsBar } from './SegmentsBar'
import { getRunwayCaption } from '@/pages/dashboard/utils/getRunwayCaption'
import { getRunwaySegments } from '@/pages/dashboard/utils/getRunwaySegments'

type RunwayWidgetProps = {
  displayCurrency: string
}

/**
 * Loads runway account data and composes the runway status, header, and segment bar
 */
export function RunwayWidget({ displayCurrency }: RunwayWidgetProps) {
  const runwayCardRef = useRef<HTMLDivElement>(null)
  const { data: incomingRunway, isFetching: runwayLoading } = useRunway()
  const { data: incomingRunwayAccountIds, isFetching: runwayAccountsLoading } = useRunwayAccounts()
  const { data: incomingAccounts, isFetching: accountsLoading } = useAccounts()
  const loadingSnapshot = useMemo(
    () => ({
      accounts: incomingAccounts,
      runway: incomingRunway,
      runwayAccountIds: incomingRunwayAccountIds,
    }),
    [incomingAccounts, incomingRunway, incomingRunwayAccountIds],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: runwayLoading || runwayAccountsLoading || accountsLoading,
    transitionKey: 'runway',
  })
  const { accounts, runway, runwayAccountIds } = displaySnapshot
  const runwayMonths = runway?.months ?? null
  const runwayBandKey = runwayBand(runwayMonths, runway?.thresholds)
  const runwayStyle = runwayBandKey ? RUNWAY_BAND_STYLE[runwayBandKey] : null
  const runwayCaption = getRunwayCaption(runway, displayCurrency)
  const fxStatus = runway?.fx_status
  const runwaySegments = useMemo(
    () => getRunwaySegments(accounts, runwayAccountIds, runway),
    [accounts, runwayAccountIds, runway],
  )

  return (
    <div ref={runwayCardRef} className="app-card relative h-[14rem] flex flex-col">
      <RunwayHeader
        fxStatus={fxStatus}
        runwayStyle={runwayStyle}
      />
      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading runway"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        <p
          className="font-financial text-3xl font-normal leading-none tracking-tight max-[1000px]:text-[1.6875rem]"
          style={{ color: runwayMonths === null ? 'var(--app-text-subtle)' : 'var(--app-text)' }}
        >
          {formatCompactRunway(runwayMonths)}
        </p>
        <RunwaySegmentsBar
          segments={runwaySegments}
          caption={runwayCaption}
          displayCurrency={displayCurrency}
          tooltipOriginRef={runwayCardRef}
        />
      </DashboardWidgetLoadingBody>
    </div>
  )
}
