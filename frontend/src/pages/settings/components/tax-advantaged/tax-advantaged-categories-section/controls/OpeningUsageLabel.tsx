import IconTooltip from '@/components/tooltips/IconTooltip'

const OPENING_USAGE_TOOLTIP = 'Opening usage is the amount already contributed or withdrawn before Lumina Finance started tracking this tax-advantaged category. Add it when setting up an existing limit so remaining room starts from the correct baseline.'

interface OpeningUsageLabelProps {
  label?: string
}

/**
 * Renders the opening usage label with the shared TAC baseline explanation
 */
export default function TaxAdvantagedOpeningUsageLabel({ label = 'Opening usage' }: OpeningUsageLabelProps) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="min-w-0 truncate">{label}</span>
      {/* Opens above, the tooltip's default, since the field or column this labels sits right beneath it.
          It floats over the dialog, so only the viewport limits the room above it */}
      <IconTooltip
        label="Opening usage info"
        sideBoundary="viewport"
        widthClassName="w-72"
        size={13}
        strokeWidth={2.25}
      >
        {OPENING_USAGE_TOOLTIP}
      </IconTooltip>
    </span>
  )
}
