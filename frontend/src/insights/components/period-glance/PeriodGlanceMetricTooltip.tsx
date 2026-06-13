import IconTooltip from '@/components/IconTooltip'

type PeriodGlanceMetricTooltipProps = {
  label: string
  calculation?: string
}

/**
 * Renders the calculation tooltip used by period-glance metrics
 */
export function PeriodGlanceMetricTooltip({ label, calculation }: PeriodGlanceMetricTooltipProps) {
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
