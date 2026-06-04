import {
  useMemo,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Repeat } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import type { FxStatus } from '@/api/dashboard'
import type { DailyCashFlow } from '@/api/transactions'
import {
  DeferredChartTooltipOverlay,
  type ChartTooltipPointer,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { formatCurrency } from '@/utils/formatCurrency'
import { PLACEHOLDER_DAILY_FLOW } from '@/transactions/components/topBand/constants'
import { parseYmdLocal } from '@/transactions/utils/date'
import { getCashFlowFxStatusMessage } from '@/transactions/utils/fxTooltipMessages'

type DailyCashFlowPoint = {
  date: string
  inflow: number
  outflow: number
  net: number
}

export type DailyCashFlowChartMode = 'net' | 'gross'

type DailyCashFlowTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
  activePayload?: Array<{
    payload?: DailyCashFlowPoint
  }>
}

const titleWordTransition = { duration: 0.34, ease: [0.16, 1, 0.3, 1] } as const
const titleWidthTransition = { duration: 0.3, ease: [0.16, 1, 0.3, 1] } as const
const titleExitWidthTransition = { delay: 0.34, duration: 0.22, ease: [0.16, 1, 0.3, 1] } as const
const titleWordVariants = {
  initial: { transition: { staggerChildren: 0.018 } },
  enter: { transition: { staggerChildren: 0.018 } },
  exit: { transition: { staggerChildren: 0.014, staggerDirection: -1 } },
} as const
const titleCharVariants = {
  initial: { y: '0.7em', opacity: 0, filter: 'blur(2px)' },
  enter: { y: 0, opacity: 1, filter: 'blur(0px)' },
  exit: { y: '-0.7em', opacity: 0, filter: 'blur(2px)' },
} as const
// Recharts runtime accepts cubic-bezier strings, but Area's public type only lists preset names.
const chartAnimationEasing = 'cubic-bezier(0.05,0.025,0.41,0.941)' as 'ease-in-out'

function getDailyCashFlowSeries(
  raw: DailyCashFlow[],
): DailyCashFlowPoint[] {
  if (raw.length === 0) return []

  // The API only returns days with activity; pad missing days so the line chart has a continuous axis.
  const byDate = new Map(raw.map((day) => [day.date, day]))
  const first = parseYmdLocal(raw[0].date)
  const last = parseYmdLocal(raw[raw.length - 1].date)
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1)
  const result: DailyCashFlowPoint[] = []

  while (cursor <= last) {
    const iso = [
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, '0'),
      String(cursor.getDate()).padStart(2, '0'),
    ].join('-')
    const entry = byDate.get(iso)
    result.push({
      date: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      inflow: entry?.inflow ?? 0,
      outflow: entry?.outflow ?? 0,
      net: (entry?.inflow ?? 0) + (entry?.outflow ?? 0),
    })
    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

function getDailyCashFlowTooltipKey(point: DailyCashFlowPoint) {
  return point.date
}

function getDailyCashFlowTooltipPointer(
  state: DailyCashFlowTooltipState,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

function getDailyCashFlowTooltipPoint(
  state: DailyCashFlowTooltipState,
  data: DailyCashFlowPoint[],
  pointsByDate: Map<string, DailyCashFlowPoint>,
) {
  const payloadPoint = state.activePayload?.[0]?.payload
  if (payloadPoint) return payloadPoint

  const activeIndex = Number(state.activeTooltipIndex)
  if (Number.isInteger(activeIndex)) return data[activeIndex]

  return state.activeLabel === undefined
    ? undefined
    : pointsByDate.get(String(state.activeLabel))
}

function DailyCashFlowTooltipContent({
  point,
  displayCurrency,
  mode,
}: {
  point: DailyCashFlowPoint
  displayCurrency: string
  mode: DailyCashFlowChartMode
}) {
  return (
    <>
      <p className="app-chart-tooltip-default-title">{point.date}</p>
      {mode === 'net' && (
        <div className="mt-1 flex justify-between gap-4">
          <span className="app-chart-tooltip-default-value">Net</span>
          <span className="app-chart-tooltip-default-value font-financial">
            {formatCurrency(point.net, displayCurrency)}
          </span>
        </div>
      )}
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Inflow</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatCurrency(Math.abs(point.inflow), displayCurrency)}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span className="app-chart-tooltip-default-value">Outflow</span>
        <span className="app-chart-tooltip-default-value font-financial">
          {formatCurrency(Math.abs(point.outflow), displayCurrency)}
        </span>
      </div>
    </>
  )
}

function DailyCashFlowTitleWord({ visible }: { visible: boolean }) {
  const shouldReduceMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.span
          key="net-title-word"
          className="inline-block overflow-hidden align-bottom"
          initial={shouldReduceMotion ? false : { width: 0 }}
          animate={{
            width: 'auto',
            transition: shouldReduceMotion ? { duration: 0 } : titleWidthTransition,
          }}
          exit={{
            width: 0,
            transition: shouldReduceMotion ? { duration: 0 } : titleExitWidthTransition,
          }}
          style={{ whiteSpace: 'nowrap' }}
        >
          <motion.span
            className="flex pl-[0.25em]"
            aria-hidden
            initial={shouldReduceMotion ? false : 'initial'}
            animate="enter"
            exit={shouldReduceMotion ? undefined : 'exit'}
            variants={titleWordVariants}
            transition={shouldReduceMotion ? { duration: 0 } : titleWordTransition}
          >
            {'Net'.split('').map((char, index) => (
              <motion.span
                key={`${char}-${index}`}
                className="inline-block"
                variants={titleCharVariants}
                transition={shouldReduceMotion ? { duration: 0 } : titleWordTransition}
              >
                {char}
              </motion.span>
            ))}
          </motion.span>
          <span className="sr-only">Net</span>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

export default function DailyCashFlowChart({
  rawDailyFlow,
  fxStatus,
  showPlaceholderData,
  displayCurrency,
  chartAnimationKey,
  prefersReducedMotion,
  mode,
  onModeToggle,
}: {
  rawDailyFlow: DailyCashFlow[]
  fxStatus: FxStatus | undefined
  showPlaceholderData: boolean
  displayCurrency: string
  chartAnimationKey: string
  prefersReducedMotion: boolean | null
  mode: DailyCashFlowChartMode
  onModeToggle: () => void
}) {
  const dailyFlowChartRef = useRef<HTMLDivElement>(null)
  const dailyFlowTooltipRef = useRef<DeferredChartTooltipOverlayHandle<DailyCashFlowPoint>>(null)
  const dailyFlow = useMemo(
    () => (showPlaceholderData ? PLACEHOLDER_DAILY_FLOW : getDailyCashFlowSeries(rawDailyFlow)),
    [showPlaceholderData, rawDailyFlow],
  )
  const dailyFlowPointsByDate = useMemo(
    () => new Map(dailyFlow.map((point) => [point.date, point])),
    [dailyFlow],
  )
  const chartAnimationDuration = prefersReducedMotion ? 0 : 1000
  const toggleLabel = mode === 'net' ? 'Show inflow and outflow' : 'Show net cash flow'
  const showDailyCashFlowTooltip = (
    state: DailyCashFlowTooltipState,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const point = getDailyCashFlowTooltipPoint(state, dailyFlow, dailyFlowPointsByDate)
    const pointer = getDailyCashFlowTooltipPointer(state, event)

    if (!point) {
      dailyFlowTooltipRef.current?.show(null, pointer)
      return
    }

    dailyFlowTooltipRef.current?.show(point, pointer)
  }
  const hideDailyCashFlowTooltip = () => dailyFlowTooltipRef.current?.hide()

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="app-label inline-flex items-center gap-2">
          <span className="inline-flex items-baseline whitespace-nowrap">
            <span>Daily</span>
            <DailyCashFlowTitleWord visible={mode === 'net'} />
            <span className="ml-[0.25em]">Cash Flow</span>
          </span>
          {fxStatus && (
            <IconTooltip
              label="Daily cash flow FX status"
              icon="fx"
              fxTone={getFxStatusTone(fxStatus)}
              placement="top"
            >
              <span className="block">{getCashFlowFxStatusMessage(fxStatus)}</span>
              {fxStatus.missing_pairs.length > 0 && (
                <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
                </span>
              )}
            </IconTooltip>
          )}
        </p>
        <button
          type="button"
          title={toggleLabel}
          aria-label={toggleLabel}
          onClick={onModeToggle}
          className="app-icon-button h-8 w-8 shrink-0"
        >
          <Repeat size={12} />
        </button>
      </div>
      <div
        ref={dailyFlowChartRef}
        className="relative h-[11.75rem]"
        onMouseLeave={hideDailyCashFlowTooltip}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            key={`daily-flow-${mode}-${chartAnimationKey}`}
            data={dailyFlow}
            margin={{ top: 4, right: 12, bottom: 0, left: 12 }}
            onMouseMove={(state, event) => showDailyCashFlowTooltip(state, event)}
            onMouseLeave={hideDailyCashFlowTooltip}
          >
            <defs>
              <linearGradient id="netFlowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--app-text-muted)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--app-text-muted)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--app-positive)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--app-positive)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="outflowGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="var(--app-negative)" stopOpacity={0.25} />
                <stop offset="100%" stopColor="var(--app-negative)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'var(--app-text-subtle)' }}
              axisLine={false}
              tickLine={false}
              interval={Math.max(0, Math.ceil(dailyFlow.length / 10) - 1)}
            />
            <YAxis hide />
            <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
            {mode === 'net' ? (
              <Area
                type="monotone"
                dataKey="net"
                stroke="var(--app-text-muted)"
                fill="url(#netFlowGrad)"
                strokeWidth={1.5}
                isAnimationActive={!prefersReducedMotion}
                animationDuration={chartAnimationDuration}
                animationEasing={chartAnimationEasing}
              />
            ) : (
              <>
                <Area
                  type="monotone"
                  dataKey="inflow"
                  stroke="var(--app-positive)"
                  fill="url(#inflowGrad)"
                  strokeWidth={1.5}
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={chartAnimationDuration}
                  animationEasing={chartAnimationEasing}
                />
                <Area
                  type="monotone"
                  dataKey="outflow"
                  stroke="var(--app-negative)"
                  fill="url(#outflowGrad)"
                  strokeWidth={1.5}
                  isAnimationActive={!prefersReducedMotion}
                  animationDuration={chartAnimationDuration}
                  animationEasing={chartAnimationEasing}
                />
              </>
            )}
          </AreaChart>
        </ResponsiveContainer>
        <DeferredChartTooltipOverlay
          ref={dailyFlowTooltipRef}
          chartRef={dailyFlowChartRef}
          className="min-w-44"
          getKey={getDailyCashFlowTooltipKey}
          renderContent={(point) => (
            <DailyCashFlowTooltipContent
              point={point}
              displayCurrency={displayCurrency}
              mode={mode}
            />
          )}
        />
      </div>
    </>
  )
}
