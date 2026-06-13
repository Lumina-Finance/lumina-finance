import { useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp, LifeBuoy } from 'lucide-react'
import { useAccounts } from '@/api/accounts'
import { useRunway, useRunwayAccounts } from '@/api/user'
import IconTooltip from '@/components/IconTooltip'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import {
  RUNWAY_BAND_STYLE,
  formatCompactRunway,
  runwayBand,
} from '@/utils/runway'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { RunwaySegmentsBar } from '@/dashboard/components/RunwaySegmentsBar'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getRunwayCaption } from '@/dashboard/utils/getRunwayCaption'
import { getRunwayFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getRunwaySegments } from '@/dashboard/utils/getRunwaySegments'

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
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <LifeBuoy size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Runway</span>
        <IconTooltip
          label="How runway is calculated"
          icon={CircleHelp}
          placement="bottom"
          widthClassName="w-64"
        >
          <span className="block">
            Runway estimates how long selected asset accounts can cover net expenses, using completed months with recorded expenses.
          </span>
          <Link
            to="/settings#runway"
            className="mt-2 inline-flex font-semibold"
            style={{ color: 'var(--app-accent)' }}
          >
            Runway settings
          </Link>
        </IconTooltip>
        {fxStatus && (
          <IconTooltip
            label="Runway FX status"
            icon="fx"
            fxTone={getFxStatusTone(fxStatus)}
            placement="top"
          >
            <span className="block">{getRunwayFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
        {runwayStyle && (
          <span
            className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold max-[1000px]:text-[0.675rem]"
            style={{ background: runwayStyle.bg, color: runwayStyle.fg }}
          >
            {runwayStyle.label}
          </span>
        )}
      </div>
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
