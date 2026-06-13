import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
import type { FxStatus } from '@/api/shared/fx'
import type { DailyCashFlow } from '@/api/transactions'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import { ChartTooltipRow, ChartTooltipTitle } from '@/components/charts/ChartTooltipContent'
import {
  getRechartsTooltipPoint,
  getRechartsTooltipPointer,
  type RechartsTooltipState,
} from '@/components/charts/rechartsTooltip'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusTone } from '@/utils/fxStatus'
import { formatCurrency } from '@/utils/formatCurrency'
import { PLACEHOLDER_DAILY_FLOW } from '@/transactions/components/topBand/constants'
import { parseYmdLocal } from '@/transactions/utils/date'
import { getCashFlowFxStatusMessage } from '@/transactions/utils/fxTooltipMessages'

type DailyCashFlowPoint = {
  key: string
  date: string
  rangeLabel: string
  inflow: number
  outflow: number
  net: number
}

export type DailyCashFlowChartMode = 'net' | 'gross'
type DailyCashFlowGranularity = 'day' | 'week' | 'month'

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
const dailyCashFlowRangeDayCount = 31
const weeklyCashFlowRangeDayCount = 183
const dailyCashFlowMaxXAxisTickCount = 10
const dailyCashFlowXAxisTickSpacing = 64
const dailyCashFlowChartMargin = { top: 4, right: 12, bottom: 0, left: 12 } as const
const dailyCashFlowXAxisPadding = { left: 20, right: 20 } as const
const dailyCashFlowXAxisCandidateSteps = [1, 2, 3, 4, 5, 7, 10, 14, 15, 21, 30] as const

// Recharts runtime accepts cubic-bezier strings, but Area's public type only lists preset names
const chartAnimationEasing = 'cubic-bezier(0.05,0.025,0.41,0.941)' as 'ease-in-out'

function formatYmdLocal(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function getDailyCashFlowGranularity(fromDate: string, toDate: string): DailyCashFlowGranularity {
  if (fromDate > toDate) return 'day'

  const from = parseYmdLocal(fromDate)
  const to = parseYmdLocal(toDate)
  const dayCount = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / 86400000) + 1,
  )

  if (dayCount <= dailyCashFlowRangeDayCount) return 'day'
  if (dayCount <= weeklyCashFlowRangeDayCount) return 'week'
  return 'month'
}

function getDailyCashFlowCadenceTitle(granularity: DailyCashFlowGranularity) {
  if (granularity === 'week') return 'Weekly'
  if (granularity === 'month') return 'Monthly'
  return 'Daily'
}

function getDailyCashFlowPeriodName(granularity: DailyCashFlowGranularity) {
  if (granularity === 'week') return 'week'
  if (granularity === 'month') return 'month'
  return 'day'
}

function getDailyCashFlowCalculation(
  granularity: DailyCashFlowGranularity,
  mode: DailyCashFlowChartMode,
) {
  const period = getDailyCashFlowPeriodName(granularity)
  return mode === 'net'
    ? `Each ${period}'s money in minus money out. Transfers count except Balance Adjustment.`
    : `Each ${period}'s money in and money out. Transfers count except Balance Adjustment.`
}

function formatCashFlowPointLabel(date: Date, granularity: DailyCashFlowGranularity) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: granularity === 'month' ? undefined : 'numeric',
  })
}

function formatCashFlowTooltipDate(date: Date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatCashFlowRangeLabel(start: Date, end: Date, granularity: DailyCashFlowGranularity) {
  if (granularity === 'day' || formatYmdLocal(start) === formatYmdLocal(end)) {
    return formatCashFlowTooltipDate(start)
  }

  return `${formatCashFlowTooltipDate(start)} - ${formatCashFlowTooltipDate(end)}`
}

function getDailyCashFlowSeries(
  raw: DailyCashFlow[],
  granularity: DailyCashFlowGranularity,
): DailyCashFlowPoint[] {
  return raw.map((entry) => {
    const bucketStart = parseYmdLocal(entry.date)
    const bucketEnd = parseYmdLocal(entry.end_date)

    return {
      key: entry.date,
      date: formatCashFlowPointLabel(bucketStart, granularity),
      rangeLabel: formatCashFlowRangeLabel(bucketStart, bucketEnd, granularity),
      inflow: entry.inflow,
      outflow: entry.outflow,
      net: entry.inflow + entry.outflow,
    }
  })
}

function getDailyCashFlowXAxisTickCount(chartWidth: number | undefined) {
  if (chartWidth === undefined) return dailyCashFlowMaxXAxisTickCount

  const usableWidth = Math.max(
    chartWidth
      - dailyCashFlowChartMargin.left
      - dailyCashFlowChartMargin.right
      - dailyCashFlowXAxisPadding.left
      - dailyCashFlowXAxisPadding.right,
    0,
  )

  return Math.max(
    2,
    Math.min(
      dailyCashFlowMaxXAxisTickCount,
      Math.floor(usableWidth / dailyCashFlowXAxisTickSpacing) + 1,
    ),
  )
}

function getDailyCashFlowXAxisTickIndexesForStep(dataLength: number, step: number) {
  const lastIndex = dataLength - 1
  const indexes: number[] = []

  for (let index = 0; index < lastIndex; index += step) {
    indexes.push(index)
  }

  const finalGap = lastIndex - indexes[indexes.length - 1]
  if (finalGap === 0) return indexes

  if (indexes.length > 1 && finalGap < step / 2) {
    indexes[indexes.length - 1] = lastIndex
    return indexes
  }

  return [...indexes, lastIndex]
}

function getDailyCashFlowXAxisTickIndexes(dataLength: number, maxTickCount: number) {
  const cappedTickCount = Math.min(maxTickCount, dataLength)
  if (cappedTickCount === 0) return []
  if (cappedTickCount === 1) return [0]

  const lastIndex = dataLength - 1
  const minimumStep = Math.max(1, Math.ceil(lastIndex / (cappedTickCount - 1)))
  const candidateSteps = dailyCashFlowXAxisCandidateSteps.some((step) => step === minimumStep)
    ? dailyCashFlowXAxisCandidateSteps
    : [...dailyCashFlowXAxisCandidateSteps, minimumStep].sort((a, b) => a - b)

  let bestIndexes = [0, lastIndex]
  let bestScore = Number.POSITIVE_INFINITY

  for (const step of candidateSteps) {
    if (step < minimumStep) continue

    const indexes = getDailyCashFlowXAxisTickIndexesForStep(dataLength, step)
    if (indexes.length > cappedTickCount) continue

    const gaps = indexes.slice(1).map((index, gapIndex) => index - indexes[gapIndex])
    const gapSpread = Math.max(...gaps) - Math.min(...gaps)
    const unusedTickPenalty = (cappedTickCount - indexes.length) * 0.2
    const score = gapSpread / step + unusedTickPenalty

    if (score < bestScore) {
      bestIndexes = indexes
      bestScore = score
    }
  }

  return bestIndexes
}

function getDailyCashFlowXAxisTicks(data: DailyCashFlowPoint[], maxTickCount: number) {
  return getDailyCashFlowXAxisTickIndexes(data.length, maxTickCount).map((index) => (
    data[index].key
  ))
}

function getDailyCashFlowTooltipKey(point: DailyCashFlowPoint) {
  return point.key
}

/**
 * Renders daily cash flow values with shared chart tooltip typography
 */
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
      <ChartTooltipTitle>{point.rangeLabel}</ChartTooltipTitle>
      {mode === 'net' && (
        <ChartTooltipRow
          label="Net"
          value={formatCurrency(point.net, displayCurrency)}
          financialValue
        />
      )}
      <ChartTooltipRow
        label="Inflow"
        value={formatCurrency(Math.abs(point.inflow), displayCurrency)}
        financialValue
      />
      <ChartTooltipRow
        label="Outflow"
        value={formatCurrency(Math.abs(point.outflow), displayCurrency)}
        financialValue
      />
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
  fromDate,
  toDate,
  fxStatus,
  showPlaceholderData,
  displayCurrency,
  chartAnimationKey,
  prefersReducedMotion,
  mode,
  onModeToggle,
}: {
  rawDailyFlow: DailyCashFlow[]
  fromDate: string
  toDate: string
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
  const [dailyFlowChartWidth, setDailyFlowChartWidth] = useState<number>()
  const dailyFlowGranularity = useMemo(
    () => getDailyCashFlowGranularity(fromDate, toDate),
    [fromDate, toDate],
  )
  const dailyFlow = useMemo(
    () => (
      showPlaceholderData
        ? PLACEHOLDER_DAILY_FLOW.map((point) => ({ ...point, key: point.date, rangeLabel: point.date }))
        : getDailyCashFlowSeries(rawDailyFlow, dailyFlowGranularity)
    ),
    [dailyFlowGranularity, rawDailyFlow, showPlaceholderData],
  )
  const dailyFlowPointsByKey = useMemo(
    () => new Map(dailyFlow.map((point) => [point.key, point])),
    [dailyFlow],
  )
  const dailyFlowLabelsByKey = useMemo(
    () => new Map(dailyFlow.map((point) => [point.key, point.date])),
    [dailyFlow],
  )
  const dailyFlowXAxisTickCount = getDailyCashFlowXAxisTickCount(dailyFlowChartWidth)
  const dailyFlowXAxisTicks = useMemo(
    () => getDailyCashFlowXAxisTicks(dailyFlow, dailyFlowXAxisTickCount),
    [dailyFlow, dailyFlowXAxisTickCount],
  )
  const dailyFlowBaselineSegment = useMemo(() => {
    if (dailyFlow.length === 0) return undefined

    return [
      { x: dailyFlow[0].key, y: 0 },
      { x: dailyFlow[dailyFlow.length - 1].key, y: 0 },
    ] as const
  }, [dailyFlow])
  const chartAnimationDuration = prefersReducedMotion ? 0 : 1000
  const toggleLabel = mode === 'net' ? 'Show inflow and outflow' : 'Show net cash flow'
  const cashFlowCadenceTitle = getDailyCashFlowCadenceTitle(dailyFlowGranularity)
  const calculationTooltipLabel = mode === 'net'
    ? `How ${cashFlowCadenceTitle.toLowerCase()} net cash flow is calculated`
    : `How ${cashFlowCadenceTitle.toLowerCase()} cash flow is calculated`
  const calculationTooltipMessage = getDailyCashFlowCalculation(dailyFlowGranularity, mode)

  useLayoutEffect(() => {
    const element = dailyFlowChartRef.current
    if (!element) return undefined

    const updateChartWidth = (width: number) => {
      const nextWidth = Math.max(Math.round(width), 0)
      setDailyFlowChartWidth((currentWidth) => (
        currentWidth === nextWidth ? currentWidth : nextWidth
      ))
    }

    updateChartWidth(element.getBoundingClientRect().width)

    if (typeof ResizeObserver === 'undefined') return undefined

    const resizeObserver = new ResizeObserver(([entry]) => {
      updateChartWidth(entry.contentRect.width)
    })
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  const showDailyCashFlowTooltip = (
    state: RechartsTooltipState<DailyCashFlowPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    const point = getRechartsTooltipPoint({
      state,
      data: dailyFlow,
      resolveLabel: (label) => dailyFlowPointsByKey.get(label),
    })
    const pointer = getRechartsTooltipPointer(state, event)

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
            <span>{cashFlowCadenceTitle}</span>
            <DailyCashFlowTitleWord visible={mode === 'net'} />
            <span className="ml-[0.25em]">Cash Flow</span>
          </span>
          <IconTooltip
            label={calculationTooltipLabel}
            level="info"
            placement="top"
            widthClassName="w-72"
          >
            {calculationTooltipMessage}
          </IconTooltip>
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
            margin={dailyCashFlowChartMargin}
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
              dataKey="key"
              tick={{ fontSize: 11, fill: 'var(--app-text-subtle)' }}
              tickFormatter={(value) => dailyFlowLabelsByKey.get(String(value)) ?? String(value)}
              axisLine={false}
              tickLine={false}
              padding={dailyCashFlowXAxisPadding}
              interval={0}
              ticks={dailyFlowXAxisTicks}
            />
            <YAxis hide />
            {dailyFlowBaselineSegment && (
              <ReferenceLine
                segment={dailyFlowBaselineSegment}
                stroke="var(--app-border-strong)"
                strokeWidth={1}
              />
            )}
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
