import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { ArrowUpToLine, Repeat } from 'lucide-react'
import { useDashboardSavingsRate } from '@/api/dashboard'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import IconTooltip from '@/components/IconTooltip'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { SavingsCurrentBoundary } from '@/dashboard/components/SavingsCurrentBoundary'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/dashboard/constants/chart'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getSavingsRateFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import {
  getSavingsRateChartData,
  getSavingsRateDisplay,
  getSavingsRateTier,
  type SavingsRateChartPoint,
} from '@/dashboard/utils/getSavingsRateChartData'
import { getSavingsRateSeries } from '@/dashboard/utils/getSavingsRateSeries'

type SavingsRateTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
  activePayload?: Array<{
    payload?: SavingsRateChartPoint
  }>
}

const savingsRateChartMargin = { top: 4, right: 4, bottom: 0, left: 4 } as const
const savingsRateHoverHighlightWidth = 70

function getSavingsRateTooltipKey(point: SavingsRateChartPoint) {
  return point.fullLabel
}

/**
 * Carries browser cursor coordinates and Recharts chart coordinates into the shared tooltip overlay
 */
function getSavingsRateTooltipPointer(
  state: SavingsRateTooltipState,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

/**
 * Renders the savings rate chart point details inside the cursor tooltip
 */
function SavingsRateTooltipContent({ point }: { point: SavingsRateChartPoint }) {
  const display = getSavingsRateDisplay(point)

  return (
    <>
      <div className="app-chart-tooltip-default-title">{point.fullLabel}</div>
      <div className="app-chart-tooltip-default-value">
        Savings Rate: {display ?? 'N/A'}
      </div>
    </>
  )
}

/**
 * Resolves the active chart point from Recharts payload data before falling back to the active label
 */
function getSavingsRateTooltipPoint(
  state: SavingsRateTooltipState,
  data: SavingsRateChartPoint[],
) {
  const payloadPoint = state.activePayload?.[0]?.payload
  if (payloadPoint) return payloadPoint

  const activeIndex = Number(state.activeTooltipIndex)
  if (Number.isInteger(activeIndex)) return data[activeIndex]

  return state.activeLabel === undefined
    ? undefined
    : data.find((point) => point.monthLabel === String(state.activeLabel))
}

/**
 * Caps the hover guide width to the active bar slot width
 */
function getSavingsRateGuideMaxWidth(chartWidth: number, pointCount: number) {
  if (pointCount <= 0) return savingsRateHoverHighlightWidth
  return Math.max(
    1,
    (chartWidth - savingsRateChartMargin.left - savingsRateChartMargin.right) / pointCount,
  )
}

/**
 * Loads savings rate data and composes the chart, FX status, and capped display toggle
 */
export function SavingsRateWidget() {
  const savingsRateChartRef = useRef<HTMLDivElement>(null)
  const savingsRateTooltipRef = useRef<DeferredChartTooltipOverlayHandle<SavingsRateChartPoint>>(null)
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
  const showSavingsRateTooltip = (
    state: SavingsRateTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const point = getSavingsRateTooltipPoint(state, chartData)
    const pointer = getSavingsRateTooltipPointer(state, event)

    if (!point) {
      savingsRateTooltipRef.current?.show(null, pointer)
      return
    }

    savingsRateTooltipRef.current?.show(point, pointer)
  }
  const hideSavingsRateTooltip = () => savingsRateTooltipRef.current?.hide()

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
        {chartData.length > 0 ? (
          <div
            ref={savingsRateChartRef}
            className="relative h-full min-h-0"
            onMouseLeave={hideSavingsRateTooltip}
          >
            {/* Recharts resolves pattern fills reliably when definitions share the chart SVG context */}
            <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
              <defs>
                {(['positive', 'accent', 'negative'] as const).map((tier) => (
                  <pattern
                    key={tier}
                    id={`savings-stripes-${tier}`}
                    patternUnits="userSpaceOnUse"
                    width={6}
                    height={6}
                    patternTransform="rotate(45)"
                  >
                    <rect
                      width={3}
                      height={6}
                      style={{ fill: `var(--app-${tier})` }}
                    />
                  </pattern>
                ))}
              </defs>
            </svg>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={savingsRateChartMargin}
                onMouseMove={(state, event) => showSavingsRateTooltip(state, event)}
                onMouseLeave={hideSavingsRateTooltip}
              >
                <XAxis
                  dataKey="monthLabel"
                  axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                  tickLine={false}
                  interval={0}
                  tick={{ fill: 'var(--app-text-subtle)', fontSize: DASHBOARD_X_AXIS_TICK_FONT_SIZE }}
                  tickMargin={3}
                />
                <YAxis
                  hide
                  domain={capSavingsRateChart ? [-100, 100] : [
                    (dataMin: number) => Math.min(0, dataMin),
                    (dataMax: number) => Math.max(0, dataMax),
                  ]}
                />
                <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
                <SavingsCurrentBoundary
                  currentLabel={chartData[chartData.length - 1].monthLabel}
                />
                <Bar dataKey="chartRate" radius={[3, 3, 0, 0]} maxBarSize={28}>
                  {chartData.map((entry, index) => {
                    const tier = getSavingsRateTier(entry.rate)
                    return (
                      <Cell
                        key={index}
                        fill={
                          entry.isCurrent
                            ? `url(#savings-stripes-${tier})`
                            : `var(--app-${tier})`
                        }
                      />
                    )
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <DeferredChartTooltipOverlay
              ref={savingsRateTooltipRef}
              chartRef={savingsRateChartRef}
              className="min-w-44"
              guideVariant="bar"
              guideWidth={savingsRateHoverHighlightWidth}
              guideMaxWidth={(chartWidth) => getSavingsRateGuideMaxWidth(chartWidth, chartData.length)}
              getKey={getSavingsRateTooltipKey}
              renderContent={(point) => (
                <SavingsRateTooltipContent point={point} />
              )}
            />
          </div>
        ) : (
          <div className="h-full" />
        )}
      </DashboardWidgetLoadingBody>
    </div>
  )
}
