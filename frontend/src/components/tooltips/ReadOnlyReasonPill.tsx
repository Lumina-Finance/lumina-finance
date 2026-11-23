import { useId } from 'react'
import { useDisabledReason } from '@/hooks/useDisabledReason'

type ReadOnlyReasonPillProps = {
  /** The id a row's description names, so a screen reader hears the reason with the row */
  id?: string
  reason: string
}

/**
 * Why a record can't change, in a pill on one line that cuts the reason short where it runs out of room
 *
 * The whole reason shows in a tooltip under the pointer, or beside the pill after a tap, where it stays
 * until the next tap elsewhere. The pill holds the whole reason in its text, so a screen reader reads it
 * all, and the tooltip adds no second copy. The record's own controls, held off with the same reason,
 * show it on keyboard focus
 */
export function ReadOnlyReasonPill({ id, reason }: ReadOnlyReasonPillProps) {
  const ownId = useId()
  const pillId = id ?? ownId
  const { controlProps, handleBlockedClick, tooltip } = useDisabledReason(reason, pillId, undefined, true)

  return (
    <>
      <span
        id={pillId}
        data-testid="read-only-reason-pill"
        className="inline-flex w-fit min-w-0 max-w-full rounded-full border px-1.5 py-0.5 text-[0.6875rem] leading-none"
        style={{ borderColor: 'var(--app-border)', color: 'var(--app-text-muted)' }}
        onMouseEnter={controlProps.onMouseEnter}
        onMouseLeave={controlProps.onMouseLeave}
        onClick={handleBlockedClick}
      >
        <span className="min-w-0 truncate">{reason}</span>
      </span>
      {tooltip}
    </>
  )
}
