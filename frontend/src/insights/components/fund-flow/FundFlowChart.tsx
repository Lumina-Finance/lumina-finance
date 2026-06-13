import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { motion } from 'motion/react'
import {
  ResponsiveContainer,
  Sankey,
  type SankeyElementType,
  type SankeyLinkProps,
  type SankeyNodeProps,
} from 'recharts'
import { ChartTooltipTitle, ChartTooltipValue } from '@/components/charts/ChartTooltipContent'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import type { FundFlowData, FundFlowNode, FundFlowNodeKind } from '@/insights/types/fundFlow'
import { formatCurrency } from '@/utils/formatCurrency'
import { applyCursorTooltipPosition } from '@/utils/tooltipPosition'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from '../InsightLoadingTransition'

type FlowTooltipPayload = Partial<FundFlowNode> & {
  value?: number | string
  source?: FundFlowNode
  target?: FundFlowNode
  payload?: FlowTooltipPayload
}

type FlowTooltipItem = {
  name?: string
  value?: number | string
  payload?: FlowTooltipPayload
}

type SankeyFlowTooltipData = {
  name: string
  amount: number
}

type FundFlowChartProps = {
  flowData: FundFlowData
  chartHeight: number
  displayCurrency: string
  emptyLabel: string
  contentConcealed: boolean
  loadingVisible: boolean
  shouldReduceMotion: boolean
}

const CHART_HEIGHT_DURATION_MS = 750
const chartHeightTransition = { duration: CHART_HEIGHT_DURATION_MS / 1000, ease: [0.22, 1, 0.36, 1] } as const

/**
 * Converts Recharts generated source-target labels into user-facing flow names
 */
function normalizeGeneratedFlowName(name?: string) {
  if (!name) return 'Flow'
  const [source, target] = name.split(' - ')
  if (!source || !target) return name
  if ((target === 'Income' || target === 'Expenses') && source !== 'Income' && source !== 'Expenses') return source
  if (source === 'Income' || source === 'Expenses') return target
  return target
}

/**
 * Resolves a readable tooltip label from Recharts Sankey node and link payloads
 */
function getFlowTooltipName(item: FlowTooltipItem) {
  const payload = item.payload
  const nestedPayload = payload?.payload
  const source = payload?.source ?? nestedPayload?.source
  const target = payload?.target ?? nestedPayload?.target

  if (!source || !target) {
    return normalizeGeneratedFlowName(item.name ?? payload?.name ?? nestedPayload?.name)
  }

  if (source.kind !== 'summary' && target.kind === 'summary') return source.name
  if (target.kind !== 'summary') return target.name
  return target.name
}

/**
 * Converts Recharts Sankey hover payloads into the tooltip view model
 */
function getSankeyFlowTooltipData(
  item: SankeyNodeProps | SankeyLinkProps,
  type: SankeyElementType,
): SankeyFlowTooltipData | null {
  const payload = item.payload as FlowTooltipPayload | undefined
  const amount = payload?.value
  const numericAmount = Number(amount)
  if (amount === undefined || !Number.isFinite(numericAmount)) return null

  return {
    name: getFlowTooltipName({
      name: type === 'node' ? payload?.name : undefined,
      value: amount,
      payload,
    }),
    amount: numericAmount,
  }
}

/**
 * Renders a custom Sankey node with side-aware labels
 */
function FlowNodeShape({ x, y, width, height, payload }: SankeyNodeProps) {
  const node = payload as unknown as FundFlowNode
  const fillByKind: Record<FundFlowNodeKind, string> = {
    income: 'var(--app-chart-positive)',
    expense: 'var(--app-chart-negative)',
    summary: 'var(--app-accent)',
    retained: 'var(--app-text-muted)',
  }
  const labelOnRight = node.labelSide
    ? node.labelSide === 'right'
    : node.kind === 'income' || (node.kind === 'summary' && node.name !== 'Expenses')
  const labelX = labelOnRight ? x + width + 10 : x - 10
  const anchor = labelOnRight ? 'start' : 'end'
  const nodeWidth = Math.max(width, 6)
  const nodeHeight = Math.max(height, 4)

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={nodeWidth}
        height={nodeHeight}
        rx={3}
        fill={fillByKind[node.kind]}
        opacity={node.kind === 'summary' ? 0.95 : 1}
      />
      <text
        x={labelX}
        y={y + height / 2}
        textAnchor={anchor}
        dominantBaseline="middle"
        fontSize={15}
        fontWeight={600}
        fill="var(--app-text-muted)"
      >
        {node.name}
      </text>
    </g>
  )
}

/**
 * Renders Sankey hover details inside the cursor tooltip portal
 */
function SankeyFlowTooltipContent({
  tooltip,
  displayCurrency,
}: {
  tooltip: SankeyFlowTooltipData
  displayCurrency: string
}) {
  return (
    <div className="min-w-44 max-w-64">
      <div className="flex justify-between gap-4">
        <ChartTooltipTitle>{tooltip.name}</ChartTooltipTitle>
        <ChartTooltipValue financial>
          {formatCurrency(tooltip.amount, displayCurrency)}
        </ChartTooltipValue>
      </div>
    </div>
  )
}

/**
 * Renders the fund-flow Sankey chart and owns cursor tooltip behaviour
 */
export function FundFlowChart({
  flowData,
  chartHeight,
  displayCurrency,
  emptyLabel,
  contentConcealed,
  loadingVisible,
  shouldReduceMotion,
}: FundFlowChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredTooltip, setHoveredTooltip] = useState<SankeyFlowTooltipData | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)

  /**
   * Repositions the cursor tooltip inside the current chart bounds
   */
  function updateTooltipPosition(clientX: number, clientY: number) {
    const chart = chartRef.current
    const tooltip = tooltipRef.current
    if (!chart || !tooltip) return

    applyCursorTooltipPosition({
      origin: chart,
      tooltip,
      clientX,
      clientY,
      xProperty: '--flow-tooltip-x',
      yProperty: '--flow-tooltip-y',
    })
  }

  /**
   * Shows the tooltip for the active Sankey node or link
   */
  function showTooltip(
    item: SankeyNodeProps | SankeyLinkProps,
    type: SankeyElementType,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) {
    updateTooltipPosition(event.clientX, event.clientY)

    const tooltip = getSankeyFlowTooltipData(item, type)
    if (!tooltip) {
      setTooltipVisible(false)
      return
    }

    setHoveredTooltip((current) => (
      current?.name === tooltip.name && current.amount === tooltip.amount
        ? current
        : tooltip
    ))
    setTooltipVisible(true)
    requestAnimationFrame(() => updateTooltipPosition(event.clientX, event.clientY))
  }

  function hideTooltip() {
    setTooltipVisible(false)
  }

  /**
   * Clears tooltip content only after the opacity transition has fully hidden it
   */
  function handleTooltipTransitionEnd(event: ReactTransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || tooltipVisible) return
    setHoveredTooltip(null)
  }

  return (
    <motion.div
      className="relative w-full overflow-hidden"
      initial={false}
      animate={{ height: chartHeight }}
      transition={shouldReduceMotion ? { duration: 0 } : chartHeightTransition}
    >
      <InsightLoadingContent
        className="relative w-full"
        concealed={contentConcealed}
        shouldReduceMotion={shouldReduceMotion}
        style={{ height: chartHeight }}
      >
        <div
          ref={chartRef}
          className="relative h-full"
          onMouseMove={(event) => updateTooltipPosition(event.clientX, event.clientY)}
          onMouseLeave={hideTooltip}
        >
          {flowData.nodes.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <Sankey
                data={flowData}
                node={FlowNodeShape}
                nodePadding={18}
                nodeWidth={6}
                verticalAlign="top"
                link={{ stroke: 'var(--app-accent)', strokeOpacity: 0.24 }}
                margin={{ top: 18, right: 12, bottom: 18, left: 12 }}
                onMouseEnter={showTooltip}
                onMouseLeave={hideTooltip}
              />
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
              {emptyLabel}
            </div>
          )}
          <CursorTooltipPortal
            ref={tooltipRef}
            onTransitionEnd={handleTooltipTransitionEnd}
            style={{
              opacity: tooltipVisible ? 1 : 0,
              transform: 'translate3d(var(--flow-tooltip-x, 0px), var(--flow-tooltip-y, 0px), 0)',
            }}
          >
            {hoveredTooltip && (
              <SankeyFlowTooltipContent
                tooltip={hoveredTooltip}
                displayCurrency={displayCurrency}
              />
            )}
          </CursorTooltipPortal>
        </div>
      </InsightLoadingContent>
      <InsightLoadingOverlay
        visible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading fund flow"
      />
    </motion.div>
  )
}
