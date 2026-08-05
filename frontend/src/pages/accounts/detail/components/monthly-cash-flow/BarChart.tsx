import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredTooltipOverlay'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'
import {
  getChartDataSignature,
  useChartEntranceAnimation,
} from '@/components/charts/useChartEntranceAnimation'
import type { CashFlowBar } from '@/pages/accounts/detail/utils/cashFlowChartViewModel'
import { MonthlyCashFlowTooltipContent } from './TooltipContent'

const cashFlowChartMargin = { top: 8, right: 0, bottom: 0, left: 0 } as const
const cashFlowHoverHighlightWidth = 70

type MonthlyCashFlowBarChartProps = {
  data: CashFlowBar[]
  domain: [number, number]
  currency: string
  tooltipLabel: (label: string) => string
}

function getCashFlowTooltipKey(point: CashFlowBar) {
  return point.label
}

/**
 * Caps the cash flow hover guide width to the active bar slot width
 */
function getCashFlowGuideMaxWidth(chartWidth: number, pointCount: number) {
  if (pointCount <= 0) return cashFlowHoverHighlightWidth
  return Math.max(
    1,
    (chartWidth - cashFlowChartMargin.left - cashFlowChartMargin.right) / pointCount,
  )
}

/**
 * Renders grouped inflow and outflow bars and owns tooltip wiring
 */
export function MonthlyCashFlowBarChart({
  data,
  domain,
  currency,
  tooltipLabel,
}: MonthlyCashFlowBarChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<CashFlowBar>>(null)

  // Income and expense both sit on Bar's default duration and begin, so one entrance instance
  // serves both, armed by whichever value changes
  const dataSignature = useMemo(
    () => getChartDataSignature(data, (point) => `${point.income}|${point.expense}`),
    [data],
  )
  const barsEntrance = useChartEntranceAnimation({ dataSignature })

  /**
   * Shows the active cash flow bar from Recharts payload, index, or label fallback
   */
  function showTooltip(
    state: RechartsTooltipState<CashFlowBar>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const point = getRechartsTooltipPoint({
      state,
      data,
      resolveLabel: (label) => data.find((entry) => entry.label === label),
    })
    const pointer = getRechartsTooltipPointer(state, event)

    if (!point) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <div
      ref={chartRef}
      className="relative h-full w-full"
      onMouseLeave={hideTooltip}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={cashFlowChartMargin}
          barGap={2}
          barCategoryGap="18%"
          onMouseMove={(state, event) => showTooltip(state, event)}
          onMouseLeave={hideTooltip}
        >
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
            tickMargin={4}
            interval={0}
          />
          <YAxis hide domain={domain} />
          <Bar
            dataKey="income"
            fill="var(--app-positive)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            opacity={0.85}
            {...barsEntrance}
          />
          <Bar
            dataKey="expense"
            fill="var(--app-negative)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            opacity={0.85}
            {...barsEntrance}
          />
        </BarChart>
      </ResponsiveContainer>
      <DeferredChartTooltipOverlay
        ref={tooltipRef}
        chartRef={chartRef}
        className="min-w-44"
        guideVariant="bar"
        guideWidth={cashFlowHoverHighlightWidth}
        guideMaxWidth={(chartWidth) => getCashFlowGuideMaxWidth(chartWidth, data.length)}
        getKey={getCashFlowTooltipKey}
        renderContent={(point) => (
          <MonthlyCashFlowTooltipContent
            point={point}
            currency={currency}
            title={tooltipLabel(point.label)}
          />
        )}
      />
    </div>
  )
}
