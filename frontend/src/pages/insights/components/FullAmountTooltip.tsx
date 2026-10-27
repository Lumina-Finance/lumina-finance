import IconTooltip from '@/components/tooltips/IconTooltip'

type FullAmountTooltipProps = {
  label: string
  compact: boolean
  fullAmount: string
}

/**
 * Renders an info icon beside a figure's label that opens the figure's exact amount, only while the
 * figure is shown in its compact form, so keyboard and touch users can read it too
 */
export function FullAmountTooltip({ label, compact, fullAmount }: FullAmountTooltipProps) {
  if (!compact) return null

  return (
    <IconTooltip
      label={`${label} in full`}
      placement="top"
      widthClassName="w-64"
      size={14}
      strokeWidth={2.25}
    >
      <span className="font-financial">{fullAmount}</span>
    </IconTooltip>
  )
}
