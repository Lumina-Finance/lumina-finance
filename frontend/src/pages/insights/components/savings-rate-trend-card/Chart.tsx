import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/TooltipContent'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredTooltipOverlay'
import {
  getChartDataSignature,
  useChartEntranceAnimation,
} from '@/components/charts/useChartEntranceAnimation'
import { SavingsCurrentBoundary } from '@/pages/dashboard/components/SavingsCurrentBoundary'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/pages/dashboard/constants/chart'
import type { SavingsRateHistoryPoint } from '@/pages/insights/types/savingsRate'
import {
  getSavingsRateAxisConfig,
  getSavingsRateChartPoints,
  type SavingsRateChartPoint,
} from '@/pages/insights/utils/savingsRateChart'
import {
  getSavingsRateTier,
  getSavingsRateTierColor,
  SAVINGS_RATE_TIERS,
} from '@/utils/savingsRateTier'
import { formatSavingsRateValue } from '@/pages/insights/utils/money'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

type SavingsRateTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
}

type SavingsRateYAxisTickProps = {
  x?: number
  y?: number
  payload?: {
    value?: number | string
  }
}

type SavingsRateChartProps = {
  series: SavingsRateHistoryPoint[]
  averageRate: number | null
  displayCurrency: string
  capRates: boolean
  emptyLabel: string
}

const savingsRateChartMargin = { top: 8, right: 8, bottom: 0, left: 4 } as const

function getSavingsRateTooltipKey(point: SavingsRateHistoryPoint) {
  return point.monthKey
}

/**
 * Resolves the pointer anchor used by the deferred chart tooltip overlay
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
 * Renders the active savings-rate point inside the shared chart tooltip
 */
function SavingsRateHistoryTooltipContent({
  point,
  displayCurrency,
}: {
  point: SavingsRateHistoryPoint
  displayCurrency: string
}) {
  const { formatCurrency } = useMoneyFormatters()

  return (
    <>
      <ChartTooltipTitle>{point.fullLabel}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Savings Rate"
        value={formatSavingsRateValue(point.rate)}
        financialValue
      />
      <ChartTooltipRow
        label="Income"
        value={formatCurrency(point.income, displayCurrency)}
        financialValue
      />
      <ChartTooltipRow
        label="Expenses"
        value={formatCurrency(point.expenses, displayCurrency)}
        financialValue
      />
    </>
  )
}

/**
 * Renders a savings-rate Y-axis tick with emphasis for the cap boundary
 */
function SavingsRateYAxisTick({
  x = 0,
  y = 0,
  payload,
}: SavingsRateYAxisTickProps) {
  const value = Number(payload?.value)

  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={11}
      fontWeight={500}
      fill="var(--app-text-subtle)"
    >
      {Number.isFinite(value) ? `${value}%` : ''}
    </text>
  )
}

/**
 * Renders the savings-rate bar chart and owns pointer-based tooltip behaviour
 */
export function SavingsRateChart({
  series,
  averageRate,
  displayCurrency,
  capRates,
  emptyLabel,
}: SavingsRateChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<SavingsRateHistoryPoint>>(null)
  const hasActivity = series.some((point) => point.income > 0 || point.expenses > 0)
  const currentPoint = series.find((point) => point.isCurrent)
  const tickLabels = new Map(series.map((point) => [point.monthKey, point.tickLabel]))
  const chartPoints = getSavingsRateChartPoints(series, capRates)
  const {
    domain,
    ticks,
    averageChartRate,
  } = getSavingsRateAxisConfig({
    chartPoints,
    averageRate,
    capRates,
  })

  // The bar height comes from chartRate, the fill from the uncapped rate and isCurrent, and the
  // capped plot switches to a fixed vertical scale that changes every height without changing a
  // single rate, so all four have to arm the entrance
  const dataSignature = useMemo(
    () => `${capRates}:${getChartDataSignature(
      chartPoints,
      (point) => `${point.chartRate}|${point.rate}|${point.isCurrent}`,
    )}`,
    [capRates, chartPoints],
  )
  const barEntrance = useChartEntranceAnimation({ dataSignature })

  /**
   * Shows the bar tooltip for the active Recharts savings-rate point
   */
  function showTooltip(
    state: SavingsRateTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const activeIndex = Number(state.activeTooltipIndex)
    const point = Number.isInteger(activeIndex)
      ? series[activeIndex]
      : series.find((item) => item.monthKey === String(state.activeLabel))
    const pointer = getSavingsRateTooltipPointer(state, event)
    if (!point) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <div className="h-[300px] shrink-0 min-[750px]:h-auto min-[750px]:min-h-0 min-[750px]:flex-1 min-[750px]:shrink">
      {!hasActivity ? (
        <div
          className="flex h-full w-full items-center justify-center text-sm"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          {emptyLabel}
        </div>
      ) : (
        <div
          ref={chartRef}
          className="relative h-full"
          onMouseLeave={hideTooltip}
        >
          <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
            <defs>
              {SAVINGS_RATE_TIERS.map((tier) => (
                <pattern
                  key={tier}
                  id={`insights-savings-stripes-${tier}`}
                  patternUnits="userSpaceOnUse"
                  width={6}
                  height={6}
                  patternTransform="rotate(45)"
                >
                  <rect
                    width={3}
                    height={6}
                    style={{ fill: getSavingsRateTierColor(tier) }}
                  />
                </pattern>
              ))}
            </defs>
          </svg>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartPoints}
              margin={savingsRateChartMargin}
              onMouseMove={(state, event) => showTooltip(state, event)}
              onMouseLeave={hideTooltip}
            >
              <XAxis
                dataKey="monthKey"
                axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                tickLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: DASHBOARD_X_AXIS_TICK_FONT_SIZE }}
                tickFormatter={(value) => tickLabels.get(String(value)) ?? String(value)}
                tickMargin={4}
              />
              <YAxis
                width={52}
                axisLine={false}
                tickLine={false}
                domain={domain}
                ticks={ticks}
                tick={<SavingsRateYAxisTick />}
              />
              <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
              {averageChartRate !== null && (
                <ReferenceLine
                  y={averageChartRate}
                  stroke="var(--app-accent)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.72}
                  strokeWidth={1}
                />
              )}
              {currentPoint && <SavingsCurrentBoundary currentLabel={currentPoint.monthKey} />}
              <Bar dataKey="chartRate" radius={[3, 3, 0, 0]} maxBarSize={30} {...barEntrance}>
                {chartPoints.map((entry: SavingsRateChartPoint) => {
                  const tier = getSavingsRateTier(entry.rate)
                  return (
                    <Cell
                      key={entry.monthKey}
                      fill={
                        entry.isCurrent
                          ? `url(#insights-savings-stripes-${tier})`
                          : getSavingsRateTierColor(tier)
                      }
                    />
                  )
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <DeferredChartTooltipOverlay
            ref={tooltipRef}
            chartRef={chartRef}
            className="min-w-48"
            getKey={getSavingsRateTooltipKey}
            renderContent={(point) => (
              <SavingsRateHistoryTooltipContent
                point={point}
                displayCurrency={displayCurrency}
              />
            )}
          />
        </div>
      )}
    </div>
  )
}
