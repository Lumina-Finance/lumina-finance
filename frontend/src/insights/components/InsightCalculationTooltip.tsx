import type { ReactNode } from 'react'
import IconTooltip from '@/components/IconTooltip'

type InsightCalculationTooltipProps = {
  label: string
  calculation?: ReactNode
}

/**
 * Renders insight calculation details with the shared tooltip sizing and icon treatment
 */
export function InsightCalculationTooltip({ label, calculation }: InsightCalculationTooltipProps) {
  if (!calculation) return null

  return (
    <IconTooltip
      label={`${label} calculation`}
      placement="top"
      widthClassName="w-72"
      size={14}
      strokeWidth={2.25}
    >
      {calculation}
    </IconTooltip>
  )
}
