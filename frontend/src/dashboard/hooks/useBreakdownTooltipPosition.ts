import { useState, type MouseEvent } from 'react'

type TooltipPosition = {
  x: number
  y: number
}

/**
 * Tracks a cursor-following tooltip position for the spending breakdown donut.
 * Recharts anchors pie tooltips to slices by default, so this supplies a clamped position.
 */
export function useBreakdownTooltipPosition() {
  const [breakdownTipPos, setBreakdownTipPos] = useState<TooltipPosition | null>(null)

  function handleBreakdownMouseMove(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    // Recharts anchors pie tooltips to slices, not the cursor. Estimate the
    // tooltip box and clamp it so the custom position stays inside the widget.
    const tooltipWidth = 160
    const tooltipHeight = 44
    const rawX = event.clientX - rect.left
    const rawY = event.clientY - rect.top
    const x = Math.max(0, Math.min(rect.width - tooltipWidth, rawX - tooltipWidth / 2))
    const y = Math.max(0, Math.min(rect.height - tooltipHeight, rawY - tooltipHeight - 8))

    setBreakdownTipPos({ x, y })
  }

  function handleBreakdownMouseLeave() {
    setBreakdownTipPos(null)
  }

  return {
    breakdownTipPos,
    handleBreakdownMouseLeave,
    handleBreakdownMouseMove,
  }
}
