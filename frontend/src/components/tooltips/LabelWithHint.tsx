import type { ComponentProps, ReactNode } from 'react'
import IconTooltip from '@/components/tooltips/IconTooltip'

type LabelWithHintProps = {
  label: string

  /** The explanation after the label, and the label stands on its own when absent */
  hint?: ReactNode

  /** The explanation's accessible name, "About" and the label unless told otherwise */
  hintLabel?: string
  hintPlacement?: ComponentProps<typeof IconTooltip>['placement']
}

/**
 * A label with an optional explanation after it, opened from an icon in the label's size and set in
 * plain case and weight, as the facts in the Bank link section and a bank connection's modal set them
 * out. The explanation opens as the keyboard reaches the icon, as it does on hover
 */
export function LabelWithHint({
  label,
  hint,
  hintLabel = `About ${label.toLowerCase()}`,
  hintPlacement = 'bottom',
}: LabelWithHintProps) {
  return (
    <>
      {label}
      {hint && (
        <IconTooltip
          label={hintLabel}
          placement={hintPlacement}
          size={12}
          widthClassName="w-max max-w-52"
          avoidsLoneWord
          picksSideOnPress
          staysInSurface
        >
          <span className="font-normal normal-case">{hint}</span>
        </IconTooltip>
      )}
    </>
  )
}
