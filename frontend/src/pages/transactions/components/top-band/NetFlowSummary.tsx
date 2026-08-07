import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { getCashFlowFxStatusMessage } from '@/pages/transactions/utils/fxTooltipMessages'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

const MAX_NET_FLOW_FONT_SIZE = 60
const netFlowCalculation =
  'Money in minus money out for this period. Transfers count except Balance Adjustment.'

/**
 * Renders the transaction overview net-flow metric with responsive financial typography
 */
export default function NetFlowSummary({
  inflow,
  outflow,
  fxStatus,
  displayCurrency,
  className = '',
}: {
  inflow: number
  outflow: number
  fxStatus: FxStatus | undefined
  displayCurrency: string
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementRef = useRef<HTMLSpanElement>(null)
  const [netFlowFontSize, setNetFlowFontSize] = useState(MAX_NET_FLOW_FONT_SIZE)
  const { formatCurrency } = useMoneyFormatters()
  const netFlow = inflow + outflow
  const netColor = netFlow >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
  const formattedNetFlow = `${netFlow >= 0 ? '+' : ''}${formatCurrency(netFlow, displayCurrency)}`

  useLayoutEffect(() => {
    const container = containerRef.current
    const measurement = measurementRef.current
    if (!container || !measurement) return
    const containerElement = container
    const measurementElement = measurement

    /**
     * Fits large currency values into the available metric width without changing layout
     */
    function updateFontSize() {
      const availableWidth = containerElement.getBoundingClientRect().width
      const measuredWidth = measurementElement.getBoundingClientRect().width
      if (availableWidth <= 0 || measuredWidth <= 0) return

      const nextSize = Math.min(
        MAX_NET_FLOW_FONT_SIZE,
        Math.max(1, (availableWidth / measuredWidth) * MAX_NET_FLOW_FONT_SIZE),
      )
      setNetFlowFontSize((current) => (Math.abs(current - nextSize) < 0.5 ? current : nextSize))
    }

    updateFontSize()

    const resizeObserver = new ResizeObserver(updateFontSize)
    resizeObserver.observe(containerElement)
    resizeObserver.observe(measurementElement)
    return () => resizeObserver.disconnect()
  }, [formattedNetFlow])

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="app-label inline-flex items-center gap-2">
          Net Flow
          <IconTooltip
            label="How net flow is calculated"
            level="info"
            placement="bottom"
            widthClassName="w-72"
          >
            {netFlowCalculation}
          </IconTooltip>
        </p>
        <FxStatusBadge
          label="Net flow FX status"
          fxStatus={fxStatus}
          placement="bottom"
          getMessage={getCashFlowFxStatusMessage}
        />
      </div>
      <p
        className="max-w-full whitespace-nowrap font-financial font-semibold leading-none tracking-tight"
        style={{ color: netColor, fontSize: `${netFlowFontSize}px` }}
      >
        {formattedNetFlow}
      </p>
      <span
        ref={measurementRef}
        className="pointer-events-none invisible absolute left-0 top-0 whitespace-nowrap font-financial text-6xl font-semibold leading-none tracking-tight"
        aria-hidden
      >
        {formattedNetFlow}
      </span>
      <div className="mt-3 flex items-center gap-4">
        <span
          className="inline-flex items-center gap-1 font-financial text-sm font-medium"
          style={{ color: 'var(--app-positive)' }}
        >
          <ArrowDownLeft size={14} aria-hidden />
          {formatCurrency(inflow, displayCurrency)}
        </span>
        <span
          className="inline-flex items-center gap-1 font-financial text-sm font-medium"
          style={{ color: 'var(--app-negative)' }}
        >
          <ArrowUpRight size={14} aria-hidden />
          {formatCurrency(Math.abs(outflow), displayCurrency)}
        </span>
      </div>
    </div>
  )
}
