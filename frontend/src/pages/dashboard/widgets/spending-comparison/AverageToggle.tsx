import type { CSSProperties } from 'react'
import type { SpendingRange } from '@/api/dashboard'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { LONG_PRESS_MS, useLongPress } from '@/hooks/useLongPress'
import { getAverageToggleTexts } from '@/pages/dashboard/utils/spendingAverageToggle'

type SpendingComparisonAverageToggleProps = {
  /** Whether the average is shown on this visit */
  on: boolean

  /** Whether the user asked to keep it on across visits */
  kept: boolean

  /** Why the average can't be shown for this range, or null while it can */
  disabledReason: string | null

  /** The range shown, whose period the tooltip names */
  range: SpendingRange

  /** Whether the average could not be loaded, which the tooltip says */
  failed?: boolean
  onClick: () => void
  onLongPress: () => void
}

const HOLD_STYLE = { '--app-hold-ms': `${LONG_PRESS_MS}ms` } as CSSProperties

/**
 * Renders the icon button that swaps the previous period for the average of the earlier ones, as the
 * other cards' icon toggles sit in their header. A click turns it on for this visit, and holding it keeps
 * it on, with a fill that grows while the press is held. The tooltip says what it is and that a hold keeps
 * it, since a long press is not visible
 */
export function SpendingComparisonAverageToggle({
  on,
  kept,
  disabledReason,
  range,
  failed = false,
  onClick,
  onLongPress,
}: SpendingComparisonAverageToggleProps) {
  const { isPressing, isFinished, handlers } = useLongPress({
    onPress: onClick,
    onLongPress,
    disabled: disabledReason !== null,
  })
  const isOn = on && disabledReason === null
  // A range the average can't cover shows the button as it is by default, whatever the user kept
  const isKept = kept && disabledReason === null
  const texts = getAverageToggleTexts(isKept, range, failed)

  return (
    <DisabledReasonButton
      {...handlers}
      disabledReason={disabledReason}
      hangReasonFromControl
      aria-pressed={isOn}
      aria-label={texts.name}
      hint={texts.tooltip}
      className="app-icon-button app-hold-toggle"
      data-on={isOn}
      data-kept={isKept}
      data-pressing={isPressing}
      data-finished={isFinished}
      style={HOLD_STYLE}
    >
      <span aria-hidden className="app-hold-toggle-label">
        <span className="app-hold-toggle-clip">
          <span className="app-hold-toggle-fill" />
        </span>
        <span className="app-hold-toggle-dot" />
        <span className="app-hold-toggle-strike" />
        <span className="relative">AVG</span>
      </span>
    </DisabledReasonButton>
  )
}
