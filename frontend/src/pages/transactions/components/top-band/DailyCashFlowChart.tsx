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
import { PLACEHOLDER_DAILY_FLOW } from '@/pages/transactions/components/top-band/constants'
import {
  DAILY_CASH_FLOW_CHART_MARGIN,
  DAILY_CASH_FLOW_X_AXIS_PADDING,
  getDailyCashFlowCadenceTitle,
  getDailyCashFlowCalculation,
  getDailyCashFlowGranularity,
  getDailyCashFlowSeries,
  getDailyCashFlowXAxisTickCount,
  getDailyCashFlowXAxisTicks,
  type DailyCashFlowChartMode,
  type DailyCashFlowPoint,
} from '@/pages/transactions/utils/dailyCashFlowChart'
import { getCashFlowFxStatusMessage } from '@/pages/transactions/utils/fxTooltipMessages'

export type { DailyCashFlowChartMode } from '@/pages/transactions/utils/dailyCashFlowChart'

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
// Recharts runtime accepts cubic-bezier strings, but Area's public type only lists preset names
const chartAnimationEasing = 'cubic-bezier(0.05,0.025,0.41,0.941)' as 'ease-in-out'

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

/**
 * Animates the optional "Net" word in the daily cash-flow chart title
 */
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

/**
 * Renders the transaction overview daily cash-flow chart
 */
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

    /**
     * Stores rounded chart width so tick density updates only when layout changes meaningfully
     */
    function updateChartWidth(width: number) {
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

  /**
   * Resolves the hovered Recharts area point and forwards it to the deferred tooltip overlay
   */
  function showDailyCashFlowTooltip(
    state: RechartsTooltipState<DailyCashFlowPoint>,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
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
            margin={DAILY_CASH_FLOW_CHART_MARGIN}
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
              padding={DAILY_CASH_FLOW_X_AXIS_PADDING}
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
