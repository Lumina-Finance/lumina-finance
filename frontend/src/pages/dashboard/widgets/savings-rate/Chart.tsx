import { useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartTooltipTitle,
  ChartTooltipValue,
} from '@/components/charts/TooltipContent'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredTooltipOverlay'
import { SavingsCurrentBoundary } from '@/pages/dashboard/components/SavingsCurrentBoundary'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/pages/dashboard/constants/chart'
import {
  getSavingsRateDisplay,
  getSavingsRateTier,
  type SavingsRateChartPoint,
} from '@/pages/dashboard/utils/getSavingsRateChartData'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'

type SavingsRateChartProps = {
  data: SavingsRateChartPoint[]
  capSavingsRateChart: boolean
}

const savingsRateChartMargin = { top: 4, right: 4, bottom: 0, left: 4 } as const
const savingsRateHoverHighlightWidth = 70

/**
 * Renders the savings rate chart point details inside the cursor tooltip
 */
function SavingsRateTooltipContent({ point }: { point: SavingsRateChartPoint }) {
  const display = getSavingsRateDisplay(point)

  return (
    <>
      <ChartTooltipTitle>{point.fullLabel}</ChartTooltipTitle>
      <ChartTooltipValue>
        Savings Rate: {display ?? 'N/A'}
      </ChartTooltipValue>
    </>
  )
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
 * Renders the savings rate bar chart and owns its tooltip wiring
 */
export function SavingsRateChart({
  data,
  capSavingsRateChart,
}: SavingsRateChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<SavingsRateChartPoint>>(null)

  /**
   * Shows the active savings rate point only when Recharts resolves a chart datum
   */
  function showTooltip(
    state: RechartsTooltipState<SavingsRateChartPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const point = getRechartsTooltipPoint({
      state,
      data,
      resolveLabel: (label) => data.find((entry) => entry.monthLabel === label),
    })
    const pointer = getRechartsTooltipPointer(state, event)

    if (!point) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  if (data.length === 0) return <div className="h-full" />

  return (
    <div
      ref={chartRef}
      className="relative h-full min-h-0"
      onMouseLeave={hideTooltip}
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
          data={data}
          margin={savingsRateChartMargin}
          onMouseMove={(state, event) => showTooltip(state, event)}
          onMouseLeave={hideTooltip}
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
            currentLabel={data[data.length - 1].monthLabel}
          />
          <Bar dataKey="chartRate" radius={[3, 3, 0, 0]} maxBarSize={28}>
            {data.map((entry, index) => {
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
        ref={tooltipRef}
        chartRef={chartRef}
        className="min-w-44"
        guideVariant="bar"
        guideWidth={savingsRateHoverHighlightWidth}
        guideMaxWidth={(chartWidth) => getSavingsRateGuideMaxWidth(chartWidth, data.length)}
        getKey={(point) => point.fullLabel}
        renderContent={(point) => (
          <SavingsRateTooltipContent point={point} />
        )}
      />
    </div>
  )
}
