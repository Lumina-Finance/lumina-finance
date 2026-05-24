import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CircleHelp, LifeBuoy } from 'lucide-react'
import { useAccounts } from '@/api/accounts'
import { useRunway, useRunwayAccounts } from '@/api/user'
import IconTooltip from '@/components/IconTooltip'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  RUNWAY_BAND_STYLE,
  formatCompactRunway,
  formatRunwayBasis,
  runwayBand,
} from '@/utils/runway'
import { useRunwayHover } from '@/dashboard/hooks/useRunwayHover'
import { getRunwaySegments } from '@/dashboard/utils/getRunwaySegments'

type RunwayWidgetProps = {
  displayCurrency: string
}

function getRunwayCaption(
  runway: ReturnType<typeof useRunway>['data'],
  displayCurrency: string,
) {
  if (!runway) return ''

  if (runway.reason === 'no_accounts') return 'Choose accounts in Settings'
  if (runway.reason === 'insufficient_history') return 'Need 1+ month of expense data'

  return `${formatCurrency(runway.avg_monthly_expense, displayCurrency)}/mth \u00B7 ${formatRunwayBasis(runway.months_covered)}`
}

export function RunwayWidget({ displayCurrency }: RunwayWidgetProps) {
  const { data: runway } = useRunway()
  const { data: runwayAccountIds } = useRunwayAccounts()
  const { data: accounts } = useAccounts()
  const runwayMonths = runway?.months ?? null
  const runwayBandKey = runwayBand(runwayMonths)
  const runwayStyle = runwayBandKey ? RUNWAY_BAND_STYLE[runwayBandKey] : null
  const runwayCaption = getRunwayCaption(runway, displayCurrency)
  const runwaySegments = useMemo(
    () => getRunwaySegments(accounts, runwayAccountIds, runway),
    [accounts, runwayAccountIds, runway],
  )
  const {
    hoveredSegment,
    runwayBarRef,
    runwayHoverXPct,
    handleRunwayMouseLeave,
    handleRunwayMouseMove,
  } = useRunwayHover(runwaySegments)

  return (
    <div className="app-card h-[14rem] flex flex-col">
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
            Runway estimates how long selected asset accounts can cover spending, using completed months with recorded expenses.
          </span>
          <Link
            to="/settings#runway"
            className="mt-2 inline-flex font-semibold"
            style={{ color: 'var(--app-accent)' }}
          >
            Runway settings
          </Link>
        </IconTooltip>
        {runwayStyle && (
          <span
            className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold max-[1000px]:text-[0.675rem]"
            style={{ background: runwayStyle.bg, color: runwayStyle.fg }}
          >
            {runwayStyle.label}
          </span>
        )}
      </div>
      <p
        className="font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]"
        style={{ color: runwayMonths === null ? 'var(--app-text-subtle)' : 'var(--app-text)' }}
      >
        {formatCompactRunway(runwayMonths)}
      </p>
      <div className="flex-1 min-h-0 flex items-center">
        <div className="relative h-12 w-full">
          <div
            ref={runwayBarRef}
            className="flex h-full gap-0.5 rounded-xl overflow-hidden"
            onMouseMove={handleRunwayMouseMove}
            onMouseLeave={handleRunwayMouseLeave}
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
                className="flex-1 flex items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
                style={{
                  background: 'var(--app-border)',
                  color: 'var(--app-text-subtle)',
                }}
              >
                {runwayCaption}
              </div>
            )}
          </div>
          {hoveredSegment && runwayHoverXPct !== null && (
            <div
              className="absolute -top-2 -translate-y-full whitespace-nowrap rounded-md px-2.5 py-1.5 pointer-events-none z-10 w-[11rem]"
              style={{
                left: `clamp(5.5rem, ${runwayHoverXPct}%, calc(100% - 5.5rem))`,
                transform: 'translateX(-50%)',
                transition: 'left 280ms cubic-bezier(0.22, 1, 0.36, 1)',
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
            >
              <div
                className="font-medium truncate text-[0.8125rem] max-[1000px]:text-[0.73125rem]"
                style={{ color: 'var(--app-text)' }}
              >
                {hoveredSegment.name}
              </div>
              <div
                className="font-financial text-[0.8125rem] max-[1000px]:text-[0.73125rem]"
                style={{ color: 'var(--app-text-muted)' }}
              >
                {formatCurrency(hoveredSegment.amount, displayCurrency)}
              </div>
            </div>
          )}
        </div>
      </div>
      {runwaySegments.length > 0 && (
        <p className="text-sm max-[1000px]:text-[0.7875rem]" style={{ color: 'var(--app-text-muted)' }}>
          {runwayCaption}
        </p>
      )}
    </div>
  )
}
