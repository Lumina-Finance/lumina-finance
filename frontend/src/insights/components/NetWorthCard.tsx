import {
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeftRight, Minus, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import {
  Area,
  Bar,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { FxStatus } from '@/api/dashboard'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/dashboard/constants/chart'
import { getInsightsNetWorthFxStatusMessage } from '@/insights/utils/fxTooltipMessages'
import { formatCurrency } from '@/utils/formatCurrency'
import { FxStatusBadge } from './FxStatusBadge'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import { InsightActionButton } from './InsightActionButton'
import { SectionHeader } from './SectionHeader'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'
import {
  NET_WORTH_AXIS_TICK_COUNT,
  formatNetWorthAxisDate,
  formatNetWorthAxisMoney,
  formatSignedNetWorthCurrency,
  getChangeKey,
  getChartKey,
  getNetWorthChartData,
  getNetWorthChartItems,
  getNetWorthDateAxisTicks,
  getNetWorthLegendItems,
  getValueKey,
  netWorthChangeColor,
  netWorthChartLeftMargin,
  type NetWorthChartItem,
  type NetWorthDeltaPoint,
  type NetWorthGroup,
  type NetWorthPoint,
  type NetWorthViewMode,
} from '../utils/netWorthChart'

export type { NetWorthViewMode } from '../utils/netWorthChart'

type AxisTickProps = {
  x?: number | string
  y?: number | string
  payload?: {
    value: number | string
  }
}

type NetWorthCardProps = {
  mode: NetWorthViewMode
  onModeToggle: () => void
  groups: NetWorthGroup[]
  baseline: number[]
  series: NetWorthPoint[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  loading?: boolean
  transitionKey: string
}

type NetWorthSnapshot = {
  mode: NetWorthViewMode
  groups: NetWorthGroup[]
  baseline: number[]
  series: NetWorthPoint[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  emptyLabel: string
}

type NetWorthTooltipState = {
  activeLabel?: string | number
  activeCoordinate?: {
    x?: number
  }
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

const netWorthChartMargin = { top: 4, right: 0, bottom: 0, left: netWorthChartLeftMargin } as const
const netWorthLegendItemTransition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const

function getNetWorthTooltipKey(point: NetWorthDeltaPoint) {
  return point.dateMs
}

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

function NetWorthXAxisTick({
  x = 0,
  y = 0,
  payload,
  axisStartMs,
  axisEndMs,
  dateLabelsByMs,
}: AxisTickProps & {
  axisStartMs: number
  axisEndMs: number
  dateLabelsByMs: Map<number, string>
}) {
  const value = Number(payload?.value)
  const tickX = Number(x)
  const tickY = Number(y)
  const textAnchor = value === axisStartMs ? 'start' : value === axisEndMs ? 'end' : 'middle'

  return (
    <text
      x={tickX}
      y={tickY}
      dy={12}
      textAnchor={textAnchor}
      fill="var(--app-text-subtle)"
      fontSize={DASHBOARD_X_AXIS_TICK_FONT_SIZE}
    >
      {dateLabelsByMs.get(value) ?? formatNetWorthAxisDate(value)}
    </text>
  )
}

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
      <p className="app-chart-tooltip-default-title">{point.tooltipLabel}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Net Worth</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatCurrency(displayedNetWorth, displayCurrency)}
        </span>
      </div>
      {mode === 'overview' && (
        <div className="mt-1 flex justify-between gap-4">
          <span className="app-chart-tooltip-default-value">Change</span>
          <span className="app-chart-tooltip-default-value font-financial">
            {formatSignedNetWorthCurrency(point.totalChange, displayCurrency)}
          </span>
        </div>
      )}
      <div className="mt-2 space-y-1 border-t border-[var(--app-border)] pt-2">
        {detailItems.map(({ item, index }) => {
          const value = Number(point[getValueKey(index)] ?? 0)
          const change = Number(point[getChangeKey(index)] ?? 0)
          const displayValue = item.kind === 'debt' ? Math.abs(value) : value
          return (
            <div key={item.id} className="flex justify-between gap-4">
              <span className="app-chart-tooltip-default-value">{item.name}</span>
              <span className="app-chart-tooltip-default-value font-financial">
                {formatCurrency(displayValue, displayCurrency)}
                {mode === 'overview' && (
                  <>
                    {' '}
                    ({formatSignedNetWorthCurrency(change, displayCurrency)})
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

export function NetWorthCard({
  mode,
  onModeToggle,
  groups,
  baseline,
  series,
  fxStatus,
  displayCurrency,
  loading = false,
  transitionKey,
}: NetWorthCardProps) {
  const netWorthChartRef = useRef<HTMLDivElement>(null)
  const netWorthTooltipRef = useRef<DeferredChartTooltipOverlayHandle<NetWorthDeltaPoint>>(null)
  const incomingSnapshot = useMemo<NetWorthSnapshot>(() => ({
    mode,
    groups,
    baseline,
    series,
    fxStatus,
    displayCurrency,
    emptyLabel: loading ? 'Loading net worth history...' : 'No net worth history in this range.',
  }), [baseline, displayCurrency, fxStatus, groups, loading, mode, series])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useInsightLoadingSnapshot<NetWorthSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const latest = displaySnapshot.series.at(-1)
  const chartItems = useMemo(
    () => getNetWorthChartItems(displaySnapshot.groups, displaySnapshot.mode),
    [displaySnapshot.groups, displaySnapshot.mode],
  )
  const deltaSeries = useMemo(
    () => getNetWorthChartData(displaySnapshot.series, chartItems, displaySnapshot.mode, displaySnapshot.baseline),
    [chartItems, displaySnapshot.baseline, displaySnapshot.mode, displaySnapshot.series],
  )
  const hasChartData = displaySnapshot.groups.length > 0 && deltaSeries.length > 0
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
  const startNetWorthAxisLabel = formatNetWorthAxisMoney(
    deltaSeries[0]?.startTotal ?? 0,
    displaySnapshot.displayCurrency,
  )
  const legendItems = useMemo(
    () => getNetWorthLegendItems(displaySnapshot.mode, chartItems),
    [chartItems, displaySnapshot.mode],
  )
  const legendAnimationKey = `${displaySnapshot.mode}-${legendItems.map((item) => item.id).join('|')}`
  const latestChange = deltaSeries.at(-1)?.totalChange ?? 0
  const netWorthTrendColor = latestChange > 0
    ? 'var(--app-chart-positive)'
    : latestChange < 0
      ? 'var(--app-chart-negative)'
      : 'var(--app-text-muted)'
  const NetWorthTrendIcon = latestChange > 0 ? TrendingUp : latestChange < 0 ? TrendingDown : Minus
  const showNetWorthTooltip = (
    state: NetWorthTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const activeDateMs = Number(state.activeLabel)
    const point = Number.isFinite(activeDateMs) ? netWorthPointsByMs.get(activeDateMs) : undefined
    const pointer = getNetWorthTooltipPointer(state, event)
    if (!point) {
      netWorthTooltipRef.current?.show(null, pointer)
      return
    }

    netWorthTooltipRef.current?.show(point, pointer)
  }
  const hideNetWorthTooltip = () => netWorthTooltipRef.current?.hide()

  return (
    <section className="app-card">
      <SectionHeader
        icon={Wallet}
        label={(
          <span className="inline-flex items-center gap-2">
            Net Worth
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Net Worth FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getInsightsNetWorthFxStatusMessage}
              />
            )}
          </span>
        )}
        action={(
          <InsightActionButton
            title={mode === 'overview' ? 'Show account type composition' : 'Show net worth change'}
            ariaLabel={mode === 'overview' ? 'Show account type composition' : 'Show net worth change'}
            onPress={onModeToggle}
          >
            <ArrowLeftRight size={12} />
          </InsightActionButton>
        )}
      />
      <div className="relative overflow-hidden">
        <InsightLoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="flex h-[360px] flex-col">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="app-label app-label-compact">Ending Net Worth</p>
            <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="font-financial text-3xl leading-none tracking-tight">
                {formatCurrency(latest?.total ?? 0, displaySnapshot.displayCurrency)}
              </p>
              <div className="flex items-center gap-1.5 pb-0.5 text-sm font-medium" style={{ color: netWorthTrendColor }}>
                <NetWorthTrendIcon size={14} aria-hidden />
                <span className="font-financial">{formatSignedNetWorthCurrency(latestChange, displaySnapshot.displayCurrency)}</span>
                <span style={{ color: 'var(--app-text-subtle)' }}>since start</span>
              </div>
            </div>
          </div>
        </div>
        <div
          ref={netWorthChartRef}
          className="relative min-h-0 flex-1"
          onMouseLeave={hideNetWorthTooltip}
        >
          {!hasChartData ? (
            <div
              className="flex h-full w-full items-center justify-center rounded-lg text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {displaySnapshot.emptyLabel}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={deltaSeries}
                margin={netWorthChartMargin}
                onMouseMove={(state, event) => showNetWorthTooltip(state, event)}
                onMouseLeave={hideNetWorthTooltip}
              >
                <XAxis
                  dataKey="dateMs"
                  type="number"
                  scale="time"
                  domain={[dateAxisStartMs, dateAxisEndMs]}
                  ticks={dateAxisTicks}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  tick={(props) => (
                    <NetWorthXAxisTick
                      {...props}
                      axisStartMs={dateAxisStartMs}
                      axisEndMs={dateAxisEndMs}
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
                  label={displaySnapshot.mode === 'overview'
                    ? {
                        value: startNetWorthAxisLabel,
                        position: 'insideTopLeft',
                        fill: 'var(--app-text-subtle)',
                        fontSize: 11,
                        fontWeight: 600,
                      }
                    : undefined}
                />
                {displaySnapshot.mode === 'composition' ? (
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
              ref={netWorthTooltipRef}
              chartRef={netWorthChartRef}
              className="min-w-64"
              getKey={getNetWorthTooltipKey}
              renderContent={(point) => (
                <NetWorthChartTooltipContent
                  point={point}
                  items={chartItems}
                  displayCurrency={displaySnapshot.displayCurrency}
                  mode={displaySnapshot.mode}
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
                        opacity: displaySnapshot.mode === 'composition' ? 0.65 : 1,
                      }}
                    />
                    <span>{item.name}</span>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
          </div>
        </InsightLoadingContent>

        <InsightLoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading net worth"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
