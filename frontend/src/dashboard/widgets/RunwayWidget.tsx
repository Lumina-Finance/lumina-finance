import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp, LifeBuoy } from 'lucide-react'
import { useAccounts } from '@/api/accounts'
import { useRunway, useRunwayAccounts } from '@/api/user'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import IconTooltip from '@/components/IconTooltip'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  RUNWAY_BAND_STYLE,
  formatCompactRunway,
  runwayBand,
} from '@/utils/runway'
import { applyCursorTooltipPosition } from '@/utils/tooltipPosition'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import type { RunwaySegment } from '@/dashboard/types/dashboard'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getRunwayCaption } from '@/dashboard/utils/getRunwayCaption'
import { getRunwayFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getRunwaySegments } from '@/dashboard/utils/getRunwaySegments'

type RunwayWidgetProps = {
  displayCurrency: string
}

function getRunwaySegmentAtX(runwaySegments: RunwaySegment[], xPct: number) {
  if (runwaySegments.length === 0) return undefined

  let cursor = 0
  for (const segment of runwaySegments) {
    cursor += segment.pct
    if (xPct <= cursor) return segment
  }

  return runwaySegments[runwaySegments.length - 1]
}

export function RunwayWidget({ displayCurrency }: RunwayWidgetProps) {
  const runwayCardRef = useRef<HTMLDivElement>(null)
  const runwayBarRef = useRef<HTMLDivElement>(null)
  const runwayTooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredSegment, setHoveredSegment] = useState<RunwaySegment | null>(null)
  const [runwayTooltipVisible, setRunwayTooltipVisible] = useState(false)
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
  const updateRunwayTooltipPosition = (clientX: number, clientY: number) => {
    const card = runwayCardRef.current
    const tooltip = runwayTooltipRef.current
    if (!card || !tooltip) return

    applyCursorTooltipPosition({
      origin: card,
      tooltip,
      clientX,
      clientY,
      xProperty: '--runway-tooltip-x',
      yProperty: '--runway-tooltip-y',
    })
  }
  const showRunwayTooltip = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (runwaySegments.length === 0) {
      setRunwayTooltipVisible(false)
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const xPct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))
    const segment = getRunwaySegmentAtX(runwaySegments, xPct)
    if (!segment) {
      setRunwayTooltipVisible(false)
      return
    }

    updateRunwayTooltipPosition(event.clientX, event.clientY)
    setHoveredSegment((current) => (
      current?.id === segment.id ? current : segment
    ))
    setRunwayTooltipVisible(true)
    requestAnimationFrame(() => updateRunwayTooltipPosition(event.clientX, event.clientY))
  }
  const hideRunwayTooltip = () => {
    setRunwayTooltipVisible(false)
  }
  const handleRunwayTooltipTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || runwayTooltipVisible) return
    setHoveredSegment(null)
  }

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
        <div className="flex min-h-0 flex-1 items-center">
          <div className="relative h-12 w-full">
            <div
              ref={runwayBarRef}
              className="flex h-full gap-0.5 overflow-hidden rounded-xl"
              onMouseEnter={showRunwayTooltip}
              onMouseMove={showRunwayTooltip}
              onMouseLeave={hideRunwayTooltip}
            >
              {runwaySegments.length > 0 ? (
                runwaySegments.map((segment) => (
                  <div
                    key={segment.id}
                    style={{ width: `${segment.pct}%`, background: segment.color }}
                  />
                ))
              ) : (
                <div
                  className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
                  style={{
                    background: 'var(--app-border)',
                    color: 'var(--app-text-subtle)',
                  }}
                >
                  {runwayCaption}
                </div>
              )}
            </div>
          </div>
        </div>
        {runwaySegments.length > 0 && (
          <p className="text-sm max-[1000px]:text-[0.7875rem]" style={{ color: 'var(--app-text-muted)' }}>
            {runwayCaption}
          </p>
        )}
      </DashboardWidgetLoadingBody>
      <CursorTooltipPortal
        ref={runwayTooltipRef}
        className="w-[11rem]"
        onTransitionEnd={handleRunwayTooltipTransitionEnd}
        style={{
          opacity: runwayTooltipVisible ? 1 : 0,
          transform: 'translate3d(var(--runway-tooltip-x, 0px), var(--runway-tooltip-y, 0px), 0)',
        }}
      >
        {hoveredSegment && (
          <>
            <div className="app-chart-tooltip-default-title truncate font-medium">
              {hoveredSegment.name}
            </div>
            <div className="app-chart-tooltip-default-value font-financial">
              {formatCurrency(hoveredSegment.amount, displayCurrency)}
            </div>
          </>
        )}
      </CursorTooltipPortal>
    </div>
  )
}
