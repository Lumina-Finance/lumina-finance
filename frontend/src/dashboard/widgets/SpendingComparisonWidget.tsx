import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
} from 'lucide-react'
import {
  type SpendingRange,
  useSpendingComparison,
} from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import IconTooltip from '@/components/IconTooltip'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import { DASHBOARD_X_AXIS_TICK_FONT_SIZE } from '@/dashboard/constants/chart'
import {
  CURRENT_LABEL_BY_RANGE,
  DASHBOARD_RANGE_SELECT_OPTIONS,
  PREVIOUS_LABEL_BY_RANGE,
  PREVIOUS_PERIOD_LABEL_BY_RANGE,
} from '@/dashboard/constants/ranges'
import type { SpendingComparisonSeriesPoint } from '@/dashboard/types/dashboard'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getSpendingComparisonFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getSpendingComparisonSeries } from '@/dashboard/utils/getSpendingComparisonSeries'

type SpendingComparisonWidgetProps = {
  displayCurrency: string
}

type SpendingComparisonXAxisTickProps = {
  x?: number | string
  y?: number | string
  payload?: {
    value?: number | string
  }
  firstLabel?: string
  lastLabel?: string
}

type SpendingComparisonTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
  activePayload?: Array<{
    payload?: SpendingComparisonSeriesPoint
  }>
}

function getSpendingComparisonXAxisTicks(
  range: SpendingRange,
  data: Array<{ label: string }>,
) {
  const labels = data.map((point) => point.label)
  if (range === 'MTD') {
    return labels.filter((_, index) => (
      index % 2 === 0 || index === labels.length - 1
    ))
  }

  return labels
}

function SpendingComparisonXAxisTick({
  x = 0,
  y = 0,
  payload,
  firstLabel,
  lastLabel,
}: SpendingComparisonXAxisTickProps) {
  const value = String(payload?.value ?? '')
  const textAnchor = value === firstLabel ? 'start' : value === lastLabel ? 'end' : 'middle'

  return (
    <text
      x={Number(x)}
      y={Number(y)}
      dy={12}
      textAnchor={textAnchor}
      fill="var(--app-text-subtle)"
      fontSize={DASHBOARD_X_AXIS_TICK_FONT_SIZE}
    >
      {value}
    </text>
  )
}

function getSpendingComparisonTooltipKey(point: SpendingComparisonSeriesPoint) {
  return point.label
}

function getSpendingComparisonTooltipPointer(
  state: SpendingComparisonTooltipState,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

function getSpendingComparisonTooltipPoint(
  state: SpendingComparisonTooltipState,
  data: SpendingComparisonSeriesPoint[],
  pointsByLabel: Map<string, SpendingComparisonSeriesPoint>,
) {
  const payloadPoint = state.activePayload?.[0]?.payload
  if (payloadPoint) return payloadPoint

  const activeIndex = Number(state.activeTooltipIndex)
  if (Number.isInteger(activeIndex)) return data[activeIndex]

  return state.activeLabel === undefined
    ? undefined
    : pointsByLabel.get(String(state.activeLabel))
}

function SpendingComparisonTooltipContent({
  point,
  displayCurrency,
  spendingRange,
}: {
  point: SpendingComparisonSeriesPoint
  displayCurrency: string
  spendingRange: SpendingRange
}) {
  const rows = [
    {
      key: 'current',
      label: CURRENT_LABEL_BY_RANGE[spendingRange],
      value: point.current,
    },
    {
      key: 'previous',
      label: PREVIOUS_LABEL_BY_RANGE[spendingRange],
      value: point.previous,
    },
  ].filter((row) => row.value != null)

  return (
    <>
      <p className="app-chart-tooltip-default-title">{point.label}</p>
      {rows.map((row) => (
        <div key={row.key} className="mt-1 flex justify-between gap-4">
          <span className="app-chart-tooltip-default-value">{row.label}</span>
          <span className="app-chart-tooltip-default-value font-financial">
            {formatCurrency(Number(row.value), displayCurrency)}
          </span>
        </div>
      ))}
    </>
  )
}

export function SpendingComparisonWidget({ displayCurrency }: SpendingComparisonWidgetProps) {
  const spendingComparisonChartRef = useRef<HTMLDivElement>(null)
  const spendingComparisonTooltipRef = useRef<DeferredChartTooltipOverlayHandle<SpendingComparisonSeriesPoint>>(null)
  const [spendingRange, setSpendingRange] = useState<SpendingRange>('MTD')
  const { data: spendingComparison, isLoading: spendingComparisonLoading } = useSpendingComparison(spendingRange)
  const fxStatus = spendingComparison?.fx_status
  const spendingChartData = useMemo(
    () => getSpendingComparisonSeries(spendingComparison),
    [spendingComparison],
  )
  const spendingXAxisTicks = useMemo(
    () => getSpendingComparisonXAxisTicks(spendingRange, spendingChartData),
    [spendingRange, spendingChartData],
  )
  const firstSpendingXAxisTick = spendingXAxisTicks[0]
  const lastSpendingXAxisTick = spendingXAxisTicks[spendingXAxisTicks.length - 1]
  const spendingPointsByLabel = useMemo(
    () => new Map(spendingChartData.map((point) => [point.label, point])),
    [spendingChartData],
  )
  const currentSeries = spendingComparison?.current ?? []
  const previousSeries = spendingComparison?.previous ?? []
  const currentHasData = currentSeries.some((value) => value > 0)
  const previousHasData = previousSeries.some((value) => value > 0)
  const spentToDate = currentSeries.at(-1) ?? 0
  const previousAtSameOffset =
    currentSeries.length === 0
      ? null
      : previousSeries[Math.min(currentSeries.length, previousSeries.length) - 1] ?? null
  const spendingDeltaPct =
    previousAtSameOffset != null && previousAtSameOffset > 0
      ? ((spentToDate - previousAtSameOffset) / previousAtSameOffset) * 100
      : null
  const spendingDeltaText =
    spendingDeltaPct == null
      ? '+00.0%'
      : `${spendingDeltaPct >= 0 ? '+' : ''}${spendingDeltaPct.toFixed(1)}%`
  const amountLoadingText = formatCurrency(888888, displayCurrency)
  const showSpendingComparisonTooltip = (
    state: SpendingComparisonTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const point = getSpendingComparisonTooltipPoint(state, spendingChartData, spendingPointsByLabel)
    const pointer = getSpendingComparisonTooltipPointer(state, event)

    if (!point || (point.current == null && point.previous == null)) {
      spendingComparisonTooltipRef.current?.show(null, pointer)
      return
    }

    spendingComparisonTooltipRef.current?.show(point, pointer)
  }
  const hideSpendingComparisonTooltip = () => spendingComparisonTooltipRef.current?.hide()

  return (
    <div className="app-card h-[470px] flex flex-col">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <BarChart3 size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label inline-flex items-baseline whitespace-nowrap">
          Spending vs. Last&nbsp;
          <AppSlotMachineText text={PREVIOUS_PERIOD_LABEL_BY_RANGE[spendingRange]} />
        </span>
        {fxStatus && (
          <IconTooltip
            label="Spending comparison FX status"
            icon="fx"
            fxTone={getFxStatusTone(fxStatus)}
            placement="top"
          >
            <span className="block">{getSpendingComparisonFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
        <TimeRangeSelector
          value={spendingRange}
          options={DASHBOARD_RANGE_SELECT_OPTIONS}
          onChange={setSpendingRange}
          ariaLabel="Spending range"
          className="ml-auto hidden min-[730px]:inline-flex"
        />
        <TimeRangeSelector
          value={spendingRange}
          options={DASHBOARD_RANGE_SELECT_OPTIONS}
          onChange={setSpendingRange}
          ariaLabel="Spending range"
          variant="mobile"
          className="w-full min-[730px]:hidden"
          sheetTitle="Spending range"
        />
      </div>
      <div className="flex items-baseline gap-2">
        <p className="font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]">
          <AppScrambledNumber
            text={formatCurrency(spentToDate, displayCurrency)}
            loading={spendingComparisonLoading}
            loadingText={amountLoadingText}
          />
        </p>
        {(spendingComparisonLoading || spendingDeltaPct != null) && (
          <div
            className="flex items-center text-sm font-medium max-[1000px]:text-[0.7875rem]"
            style={{
              color: spendingComparisonLoading || spendingDeltaPct == null
                ? 'var(--app-text-muted)'
                : spendingDeltaPct <= 0
                  ? 'var(--app-positive)'
                  : 'var(--app-negative)',
            }}
          >
            {!spendingComparisonLoading && spendingDeltaPct != null && (
              spendingDeltaPct <= 0 ? (
                <ArrowDownRight size={14} aria-hidden />
              ) : (
                <ArrowUpRight size={14} aria-hidden />
              )
            )}
            <AppScrambledNumber
              text={spendingDeltaText}
              loading={spendingComparisonLoading}
              loadingText="+00.0%"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 mt-2 mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: 'var(--app-accent)',
              opacity: currentHasData ? 1 : 0.4,
            }}
          />
          <span
            className="text-xs max-[1000px]:text-[0.675rem]"
            style={{
              color: 'var(--app-text-muted)',
              fontStyle: currentHasData ? 'normal' : 'italic',
            }}
          >
            {currentHasData
              ? CURRENT_LABEL_BY_RANGE[spendingRange]
              : `No data for ${CURRENT_LABEL_BY_RANGE[spendingRange].toLowerCase()}`}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{
              background: 'var(--app-text-muted)',
              opacity: previousHasData ? 1 : 0.4,
            }}
          />
          <span
            className="text-xs max-[1000px]:text-[0.675rem]"
            style={{
              color: 'var(--app-text-muted)',
              fontStyle: previousHasData ? 'normal' : 'italic',
            }}
          >
            {previousHasData
              ? PREVIOUS_LABEL_BY_RANGE[spendingRange]
              : `No data for ${PREVIOUS_LABEL_BY_RANGE[spendingRange].toLowerCase()}`}
          </span>
        </div>
      </div>
      <div
        ref={spendingComparisonChartRef}
        className="relative flex-1 min-h-0"
        onMouseLeave={hideSpendingComparisonTooltip}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={spendingChartData}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
            onMouseMove={(state, event) => showSpendingComparisonTooltip(state, event)}
            onMouseLeave={hideSpendingComparisonTooltip}
          >
            <defs>
              <linearGradient id="spendCurrentFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--app-accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--app-accent)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="spendPreviousFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--app-text-muted)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--app-text-muted)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              xAxisId="plot"
              dataKey="label"
              hide
            />
            <XAxis
              xAxisId="labels"
              dataKey="label"
              axisLine={false}
              tickLine={false}
              interval={0}
              ticks={spendingXAxisTicks}
              tick={(props) => (
                <SpendingComparisonXAxisTick
                  {...props}
                  firstLabel={firstSpendingXAxisTick}
                  lastLabel={lastSpendingXAxisTick}
                />
              )}
              tickMargin={4}
            />
            <YAxis hide />
            <Area
              xAxisId="plot"
              type="monotone"
              dataKey="previous"
              stroke="var(--app-text-muted)"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              fill="url(#spendPreviousFill)"
              connectNulls={false}
            />
            <Area
              xAxisId="plot"
              type="monotone"
              dataKey="current"
              stroke="var(--app-accent)"
              strokeWidth={2.5}
              fill="url(#spendCurrentFill)"
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        <DeferredChartTooltipOverlay
          ref={spendingComparisonTooltipRef}
          chartRef={spendingComparisonChartRef}
          className="min-w-48"
          getKey={getSpendingComparisonTooltipKey}
          renderContent={(point) => (
            <SpendingComparisonTooltipContent
              point={point}
              displayCurrency={displayCurrency}
              spendingRange={spendingRange}
            />
          )}
        />
      </div>
    </div>
  )
}
