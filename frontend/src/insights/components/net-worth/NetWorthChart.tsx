import {
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Area,
  Bar,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/ChartTooltipContent'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/dashboard/constants/chart'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  NET_WORTH_AXIS_TICK_COUNT,
  formatNetWorthAxisDate,
  formatNetWorthAxisMoney,
  formatSignedNetWorthCurrency,
  getChangeKey,
  getChartKey,
  getNetWorthDateAxisTicks,
  getNetWorthLegendItems,
  getValueKey,
  netWorthChangeColor,
  netWorthChartLeftMargin,
  type NetWorthChartItem,
  type NetWorthDeltaPoint,
  type NetWorthGroup,
  type NetWorthViewMode,
} from '../../utils/netWorthChart'

type AxisTickProps = {
  x?: number | string
  y?: number | string
  payload?: {
    value: number | string
  }
}

type NetWorthTooltipState = {
  activeLabel?: string | number
  activeCoordinate?: {
    x?: number
  }
}

type NetWorthChartProps = {
  mode: NetWorthViewMode
  groups: NetWorthGroup[]
  chartItems: NetWorthChartItem[]
  deltaSeries: NetWorthDeltaPoint[]
  displayCurrency: string
  emptyLabel: string
  shouldReduceMotion: boolean
}

const netWorthLegendContainerVariants = {
  initial: { transition: { staggerChildren: 0.035, staggerDirection: 1 } },
  enter: { transition: { staggerChildren: 0.045, staggerDirection: 1, delayChildren: 0.03 } },
  exit: { transition: { staggerChildren: 0.035, staggerDirection: 1 } },
} as const

const netWorthLegendItemVariants = {
  initial: { opacity: 0, x: -10 },
  enter: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 10 },
} as const

const netWorthChartMargin = { top: 18, right: 0, bottom: 0, left: netWorthChartLeftMargin } as const
const netWorthXAxisPadding = { left: 28, right: 28 } as const
const netWorthLegendItemTransition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const

function getNetWorthTooltipKey(point: NetWorthDeltaPoint) {
  return point.dateMs
}

/**
 * Places the starting net-worth label above the positive contribution stack
 */
function getNetWorthFirstBarLabelY(point: NetWorthDeltaPoint, items: NetWorthChartItem[]) {
  const positiveStack = items.reduce((sum, _item, index) => {
    const value = Number(point[getChartKey(index)] ?? 0)
    return value > 0 ? sum + value : sum
  }, 0)

  return positiveStack > 0 ? positiveStack : 0
}

/**
 * Resolves the pointer anchor used by the deferred chart tooltip overlay
 */
function getNetWorthTooltipPointer(
  state: NetWorthTooltipState,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

/**
 * Renders a net-worth X-axis tick using the memoized date label map
 */
function NetWorthXAxisTick({
  x = 0,
  y = 0,
  payload,
  dateLabelsByMs,
}: AxisTickProps & {
  dateLabelsByMs: Map<number, string>
}) {
  const value = Number(payload?.value)
  const tickX = Number(x)
  const tickY = Number(y)

  return (
    <text
      x={tickX}
      y={tickY}
      dy={12}
      textAnchor="middle"
      fill="var(--app-text-subtle)"
      fontSize={DASHBOARD_X_AXIS_TICK_FONT_SIZE}
    >
      {dateLabelsByMs.get(value) ?? formatNetWorthAxisDate(value)}
    </text>
  )
}

/**
 * Renders net-worth totals and group breakdown values inside the shared chart tooltip
 */
function NetWorthChartTooltipContent({
  point,
  items,
  displayCurrency,
  mode,
}: {
  point: NetWorthDeltaPoint
  items: NetWorthChartItem[]
  displayCurrency: string
  mode: NetWorthViewMode
}) {
  const detailItems = items.map((item, index) => ({ item, index }))
  const displayedNetWorth = mode === 'composition'
    ? detailItems.reduce((sum, { index }) => sum + Number(point[getValueKey(index)] ?? 0), 0)
    : point.total

  return (
    <>
      <ChartTooltipTitle>{point.tooltipLabel}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Net Worth"
        value={formatCurrency(displayedNetWorth, displayCurrency)}
        financialValue
      />
      {mode === 'overview' && (
        <ChartTooltipRow
          label="Change"
          value={formatSignedNetWorthCurrency(point.totalChange, displayCurrency)}
          financialValue
        />
      )}
      <div className="mt-2 space-y-1 border-t border-[var(--app-border)] pt-2">
        {detailItems.map(({ item, index }) => {
          const value = Number(point[getValueKey(index)] ?? 0)
          const change = Number(point[getChangeKey(index)] ?? 0)
          const displayValue = item.kind === 'debt' ? Math.abs(value) : value
          return (
            <ChartTooltipRow
              key={item.id}
              className="mt-0"
              label={item.name}
              value={(
                <>
                  {formatCurrency(displayValue, displayCurrency)}
                  {mode === 'overview' && (
                    <>
                      {' '}
                      ({formatSignedNetWorthCurrency(change, displayCurrency)})
                    </>
                  )}
                </>
              )}
              financialValue
            />
          )
        })}
      </div>
    </>
  )
}

/**
 * Renders the net-worth composed chart, animated legend, and cursor tooltip
 */
export function NetWorthChart({
  mode,
  groups,
  chartItems,
  deltaSeries,
  displayCurrency,
  emptyLabel,
  shouldReduceMotion,
}: NetWorthChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<NetWorthDeltaPoint>>(null)
  const hasChartData = groups.length > 0 && deltaSeries.length > 0
  const dateAxisStartMs = deltaSeries[0]?.dateMs ?? 0
  const dateAxisEndMs = deltaSeries.at(-1)?.dateMs ?? dateAxisStartMs
  const dateAxisTicks = useMemo(
    () => getNetWorthDateAxisTicks(deltaSeries, NET_WORTH_AXIS_TICK_COUNT),
    [deltaSeries],
  )
  const dateLabelsByMs = useMemo(
    () => new Map(deltaSeries.map((point) => [point.dateMs, point.dateLabel])),
    [deltaSeries],
  )
  const netWorthPointsByMs = useMemo(
    () => new Map(deltaSeries.map((point) => [point.dateMs, point])),
    [deltaSeries],
  )
  const startNetWorthAxisLabel = formatNetWorthAxisMoney(deltaSeries[0]?.startTotal ?? 0, displayCurrency)
  const startNetWorthLabelPoint = mode === 'overview' ? deltaSeries[0] : undefined
  const startNetWorthLabelY = startNetWorthLabelPoint
    ? getNetWorthFirstBarLabelY(startNetWorthLabelPoint, chartItems)
    : 0
  const legendItems = useMemo(
    () => getNetWorthLegendItems(mode, chartItems),
    [chartItems, mode],
  )
  const legendAnimationKey = `${mode}-${legendItems.map((item) => item.id).join('|')}`

  /**
   * Shows the tooltip for the active Recharts date bucket
   */
  function showTooltip(
    state: NetWorthTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    const activeDateMs = Number(state.activeLabel)
    const point = Number.isFinite(activeDateMs) ? netWorthPointsByMs.get(activeDateMs) : undefined
    const pointer = getNetWorthTooltipPointer(state, event)
    if (!point) {
      tooltipRef.current?.show(null, pointer)
      return
    }

    tooltipRef.current?.show(point, pointer)
  }

  const hideTooltip = () => tooltipRef.current?.hide()

  return (
    <>
      <div
        ref={chartRef}
        className="relative min-h-0 flex-1"
        onMouseLeave={hideTooltip}
      >
        {!hasChartData ? (
          <div
            className="flex h-full w-full items-center justify-center rounded-lg text-sm"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            {emptyLabel}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={deltaSeries}
              margin={netWorthChartMargin}
              onMouseMove={(state, event) => showTooltip(state, event)}
              onMouseLeave={hideTooltip}
            >
              <XAxis
                dataKey="dateMs"
                type="number"
                scale="time"
                domain={[dateAxisStartMs, dateAxisEndMs]}
                padding={netWorthXAxisPadding}
                ticks={dateAxisTicks}
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={(props) => (
                  <NetWorthXAxisTick
                    {...props}
                    dateLabelsByMs={dateLabelsByMs}
                  />
                )}
                tickMargin={4}
              />
              <YAxis
                hide
                domain={[(dataMin: number) => Math.min(dataMin, 0), (dataMax: number) => Math.max(dataMax, 0)]}
              />
              <ReferenceLine
                y={0}
                stroke="var(--app-border-strong)"
                strokeWidth={1}
              />
              {startNetWorthLabelPoint && (
                <ReferenceDot
                  x={startNetWorthLabelPoint.dateMs}
                  y={startNetWorthLabelY}
                  r={0}
                  fill="transparent"
                  stroke="transparent"
                  ifOverflow="visible"
                  label={{
                    value: startNetWorthAxisLabel,
                    position: 'top',
                    offset: 4,
                    fill: 'var(--app-text-subtle)',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              )}
              {mode === 'composition' ? (
                chartItems.map((item, index) => (
                  <Area
                    key={item.id}
                    type="monotone"
                    dataKey={getChartKey(index)}
                    stackId={item.kind}
                    stroke={item.color}
                    strokeWidth={1.5}
                    fill={item.color}
                    fillOpacity={0.65}
                    activeDot={false}
                  />
                ))
              ) : (
                <>
                  {chartItems.map((item, index) => (
                    <Bar
                      key={item.id}
                      dataKey={getChartKey(index)}
                      stackId="net-worth-contribution"
                      fill={item.color}
                      maxBarSize={34}
                      radius={4}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="totalChange"
                    stroke={netWorthChangeColor}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {hasChartData && (
          <DeferredChartTooltipOverlay
            ref={tooltipRef}
            chartRef={chartRef}
            className="min-w-64"
            getKey={getNetWorthTooltipKey}
            renderContent={(point) => (
              <NetWorthChartTooltipContent
                point={point}
                items={chartItems}
                displayCurrency={displayCurrency}
                mode={mode}
              />
            )}
          />
        )}
      </div>
      <div className="mt-3 overflow-hidden">
        <AnimatePresence initial={false} mode="wait">
          {hasChartData && (
            <motion.div
              key={legendAnimationKey}
              className="flex flex-wrap justify-center gap-x-4 gap-y-1"
              variants={shouldReduceMotion ? undefined : netWorthLegendContainerVariants}
              initial={shouldReduceMotion ? false : 'initial'}
              animate={shouldReduceMotion ? { opacity: 1 } : 'enter'}
              exit={shouldReduceMotion ? undefined : 'exit'}
            >
              {legendItems.map((item) => (
                <motion.div
                  key={item.id}
                  className="flex items-center gap-1.5 text-xs"
                  style={{ color: 'var(--app-text-muted)' }}
                  variants={shouldReduceMotion ? undefined : netWorthLegendItemVariants}
                  transition={shouldReduceMotion ? { duration: 0 } : netWorthLegendItemTransition}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      background: item.color,
                      opacity: mode === 'composition' ? 0.65 : 1,
                    }}
                  />
                  <span>{item.name}</span>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
