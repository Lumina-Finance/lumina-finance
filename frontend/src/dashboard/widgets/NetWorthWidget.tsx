import { useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import { Wallet } from 'lucide-react'
import { useDashboardNetWorth } from '@/api/dashboard'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import IconTooltip from '@/components/IconTooltip'
import {
  DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
  DASHBOARD_NET_WORTH_X_AXIS_TICK_COUNT,
  DASHBOARD_X_AXIS_TICK_FONT_SIZE,
} from '@/dashboard/constants/chart'
import { formatCurrency } from '@/utils/formatCurrency'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getNetWorthFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getNetWorthSeries } from '@/dashboard/utils/getNetWorthSeries'
import type { NetWorthSeriesPoint } from '@/dashboard/types/dashboard'

type NetWorthWidgetProps = {
  displayCurrency: string
}

type NetWorthTooltipTarget = {
  point: NetWorthSeriesPoint
  chartX: number
}

type NetWorthTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
  activePayload?: Array<{
    payload?: NetWorthSeriesPoint
  }>
}

function formatNetWorthChange(amount: number, currency: string) {
  if (amount === 0) return formatDashboardMoney(0, currency, 'netWorth')
  return `${amount > 0 ? '+' : '-'}${formatDashboardMoney(Math.abs(amount), currency, 'netWorth')}`
}

function getNetWorthXAxisTicks(data: NetWorthSeriesPoint[]) {
  const tickCount = Math.min(DASHBOARD_NET_WORTH_X_AXIS_TICK_COUNT, data.length)
  if (tickCount <= 1) return data.map((point) => point.date)

  const lastIndex = data.length - 1
  return Array.from({ length: tickCount }, (_, index) => (
    data[Math.round((lastIndex * index) / (tickCount - 1))].date
  ))
}

const netWorthChartMargin = { top: 4, right: 4, bottom: 0, left: 4 } as const

function getNetWorthTooltipKey(point: NetWorthSeriesPoint) {
  return point.date
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

function NetWorthTooltipContent({
  point,
  displayCurrency,
}: {
  point: NetWorthSeriesPoint
  displayCurrency: string
}) {
  return (
    <>
      <p className="app-chart-tooltip-default-title">{point.date}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Net Worth</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatCurrency(point.value, displayCurrency)}
        </span>
      </div>
    </>
  )
}

function getNetWorthTooltipPoint(
  state: NetWorthTooltipState,
  data: NetWorthSeriesPoint[],
  pointsByDate: Map<string, NetWorthSeriesPoint>,
) {
  const payloadPoint = state.activePayload?.[0]?.payload
  if (payloadPoint) return payloadPoint

  const activeIndex = Number(state.activeTooltipIndex)
  if (Number.isInteger(activeIndex)) return data[activeIndex]

  return state.activeLabel === undefined
    ? undefined
    : pointsByDate.get(String(state.activeLabel))
}

function getNetWorthTooltipTargetFromCursor(
  clientX: number,
  chart: HTMLDivElement | null,
  data: NetWorthSeriesPoint[],
): NetWorthTooltipTarget | undefined {
  const rect = chart?.getBoundingClientRect()
  if (!rect || data.length === 0) return undefined

  const plotLeft = netWorthChartMargin.left
  const plotWidth = Math.max(rect.width - netWorthChartMargin.left - netWorthChartMargin.right, 1)
  const ratio = Math.min(Math.max((clientX - rect.left - plotLeft) / plotWidth, 0), 1)
  const index = data.length === 1 ? 0 : Math.round(ratio * (data.length - 1))
  const chartX = plotLeft + (data.length === 1 ? 0 : (plotWidth * index) / (data.length - 1))

  return {
    point: data[index],
    chartX,
  }
}

export function NetWorthWidget({ displayCurrency }: NetWorthWidgetProps) {
  const netWorthChartRef = useRef<HTMLDivElement>(null)
  const netWorthTooltipRef = useRef<DeferredChartTooltipOverlayHandle<NetWorthSeriesPoint>>(null)
  const { data: dashboardNetWorth } = useDashboardNetWorth()
  const netWorthData = useMemo(
    () => getNetWorthSeries(dashboardNetWorth),
    [dashboardNetWorth],
  )
  const netWorthXAxisTicks = useMemo(
    () => getNetWorthXAxisTicks(netWorthData),
    [netWorthData],
  )
  const netWorthPointsByDate = useMemo(
    () => new Map(netWorthData.map((point) => [point.date, point])),
    [netWorthData],
  )
  const netWorth = dashboardNetWorth?.current_net_worth ?? 0
  const netWorthChange = netWorthData.length >= 2 ? netWorth - netWorthData[0].value : null
  const fxStatus = dashboardNetWorth?.fx_status
  const fxTone = getFxStatusTone(fxStatus)
  const netWorthColor = netWorth < 0 ? 'var(--app-negative)' : 'var(--app-text)'
  const netWorthChangeColor =
    netWorthChange == null || netWorthChange === 0
      ? 'var(--app-text-muted)'
      : netWorthChange > 0
        ? 'var(--app-positive)'
        : 'var(--app-negative)'
  const netWorthTrendUp =
    netWorthData.length >= 2 &&
    netWorthData[netWorthData.length - 1].value >= netWorthData[0].value
  const netWorthLineColor = netWorthTrendUp ? 'var(--app-positive)' : 'var(--app-negative)'
  const showNetWorthTooltip = (
    state: NetWorthTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const fallbackTarget = getNetWorthTooltipTargetFromCursor(event.clientX, netWorthChartRef.current, netWorthData)
    const point = getNetWorthTooltipPoint(state, netWorthData, netWorthPointsByDate) ?? fallbackTarget?.point
    const pointer = {
      ...getNetWorthTooltipPointer(state, event),
      chartX: typeof state.activeCoordinate?.x === 'number'
        ? state.activeCoordinate.x
        : fallbackTarget?.chartX,
    }

    if (!point) {
      netWorthTooltipRef.current?.show(null, pointer)
      return
    }

    netWorthTooltipRef.current?.show(point, pointer)
  }
  const hideNetWorthTooltip = () => netWorthTooltipRef.current?.hide()

  return (
    <div className="app-card h-[14rem] pb-2 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <Wallet size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label">Net Worth</span>
        {fxStatus && (
          <IconTooltip
            label="Net worth FX status"
            icon="fx"
            fxTone={fxTone}
            placement="top"
          >
            <span className="block">{getNetWorthFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
      </div>
      <div className="inline-flex max-w-full items-end gap-2">
        <p
          className="min-w-0 font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]"
          style={{ color: netWorthColor }}
        >
          {formatDashboardMoney(netWorth, displayCurrency, 'netWorth')}
        </p>
        {netWorthChange != null && (
          <p
            className="shrink-0 pb-0.5 font-financial text-sm font-medium leading-none max-[1000px]:text-xs"
            style={{ color: netWorthChangeColor }}
            aria-label={`Net worth change ${formatNetWorthChange(netWorthChange, displayCurrency)}`}
          >
            {formatNetWorthChange(netWorthChange, displayCurrency)}
          </p>
        )}
      </div>
      {netWorthData.length >= 2 && (
        <div
          ref={netWorthChartRef}
          className="relative mt-3 min-h-0 flex-1"
          onMouseLeave={hideNetWorthTooltip}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={netWorthData}
              margin={netWorthChartMargin}
              onMouseMove={(state, event) => showNetWorthTooltip(state, event)}
              onMouseLeave={hideNetWorthTooltip}
            >
              <XAxis
                xAxisId="plot"
                dataKey="date"
                hide
              />
              <XAxis
                xAxisId="labels"
                dataKey="date"
                axisLine={{ stroke: 'var(--app-border)', strokeWidth: 1 }}
                tickLine={false}
                interval={0}
                ticks={netWorthXAxisTicks}
                padding={{
                  left: DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
                  right: DASHBOARD_NET_WORTH_X_AXIS_LABEL_PADDING,
                }}
                tick={{ fill: 'var(--app-text-subtle)', fontSize: DASHBOARD_X_AXIS_TICK_FONT_SIZE }}
                tickMargin={3}
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line
                xAxisId="plot"
                type="monotone"
                dataKey="value"
                stroke={netWorthLineColor}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
          <DeferredChartTooltipOverlay
            ref={netWorthTooltipRef}
            chartRef={netWorthChartRef}
            className="min-w-44"
            getKey={getNetWorthTooltipKey}
            showGuide={false}
            renderContent={(point) => (
              <NetWorthTooltipContent
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
