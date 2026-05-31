import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import type { FxStatus } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { formatCurrency } from '@/utils/formatCurrency'

const MAX_NET_FLOW_FONT_SIZE = 60

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
  const netFlow = inflow + outflow
  const netColor = netFlow >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'
  const formattedNetFlow = `${netFlow >= 0 ? '+' : ''}${formatCurrency(netFlow, displayCurrency)}`

  useLayoutEffect(() => {
    const container = containerRef.current
    const measurement = measurementRef.current
    if (!container || !measurement) return

    const updateFontSize = () => {
      const availableWidth = container.getBoundingClientRect().width
      const measuredWidth = measurement.getBoundingClientRect().width
      if (availableWidth <= 0 || measuredWidth <= 0) return

      const nextSize = Math.min(
        MAX_NET_FLOW_FONT_SIZE,
        Math.max(1, (availableWidth / measuredWidth) * MAX_NET_FLOW_FONT_SIZE),
      )
      setNetFlowFontSize((current) => (Math.abs(current - nextSize) < 0.5 ? current : nextSize))
    }

    updateFontSize()

    const resizeObserver = new ResizeObserver(updateFontSize)
    resizeObserver.observe(container)
    resizeObserver.observe(measurement)
    return () => resizeObserver.disconnect()
  }, [formattedNetFlow])

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="app-label">Net Flow</p>
        {fxStatus && (
          <IconTooltip
            label="Net flow FX status"
            icon="fx"
            fxTone={getFxStatusTone(fxStatus)}
            placement="top"
            widthClassName="w-64"
          >
            <span className="block">{getFxStatusMessage(fxStatus)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
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
