import { useId } from 'react'
import { useDisabledReason } from '@/hooks/useDisabledReason'

type ReadOnlyReasonPillProps = {
  /** The id a row's description names, so a screen reader hears the reason with the row */
  id?: string
  reason: string

  /**
   * Makes the pill a tab stop of its own, for a dialogue or card where no other control carries the
   * reason. A row or card that is itself a control leaves it out and shows the reason from its own
   * focus through `useReadOnlyReasonOnFocus`, so the row keeps a single stop
   */
  focusable?: boolean
}

/**
 * Why a record can't change, in a pill on one line that cuts the reason short where it runs out of room
 *
 * The pill is positioned, so it sits above a row's press layer and takes the hover and tap itself
 *
 * The whole reason shows in a tooltip under the pointer, or beside the pill after a tap, where it stays
 * until the next tap elsewhere. A focusable pill also shows the whole reason beside itself on keyboard
 * focus, as an `IconTooltip` trigger does. The pill holds the whole reason in its text, so a screen
 * reader reads it all, and the tooltip adds no second copy
 */
export function ReadOnlyReasonPill({ id, reason, focusable = false }: ReadOnlyReasonPillProps) {
  const ownId = useId()
  const pillId = id ?? ownId
  const { controlProps, handleBlockedClick, tooltip } = useDisabledReason(reason, pillId, undefined, true)

  return (
    <>
      <span
        id={pillId}
        data-testid="read-only-reason-pill"
        tabIndex={focusable ? 0 : undefined}
        className="relative inline-flex w-fit min-w-0 max-w-full rounded-full border px-1.5 py-0.5 text-[0.6875rem] leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]"
        style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
        onMouseEnter={controlProps.onMouseEnter}
        onMouseLeave={controlProps.onMouseLeave}
        onFocus={focusable ? controlProps.onFocus : undefined}
        onBlur={focusable ? controlProps.onBlur : undefined}
        onClick={handleBlockedClick}
      >
        <span className="min-w-0 truncate">{reason}</span>
      </span>
      {tooltip}
    </>
  )
}
