import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useReducedMotion } from 'motion/react'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { useCursorTooltip } from '@/hooks/useCursorTooltip'
import { getReasonAnchor, getViewportBounds } from '@/utils/disabledReasonAnchor'

type ReasonEvent = MouseEvent<HTMLElement>

/**
 * What a control that is unavailable for a reason takes in place of the native `disabled` attribute
 *
 * `aria-disabled` keeps the control reachable, so the mouse, the keyboard and a touch all find the
 * reason, and the description names it for a screen reader. The handlers are for the control's own
 * element and are composed with any it already has
 */
export type DisabledReasonControlProps = {
  'aria-disabled'?: true
  'aria-describedby'?: string
  onMouseEnter?: (event: ReasonEvent) => void
  onMouseMove?: (event: ReasonEvent) => void
  onMouseLeave?: () => void
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: () => void
}

const TOOLTIP_X_PROPERTY = '--disabled-reason-tooltip-x'
const TOOLTIP_Y_PROPERTY = '--disabled-reason-tooltip-y'

/** The tooltip draws no motion when reduced, so it appears where the pointer entered and stays there */
const REDUCED_MOTION_STYLE = { transition: 'none', willChange: 'auto' } as const

function getReasonKey(reason: string) {
  return reason
}
/**
 * Explains why a control is unavailable, in a tooltip that follows the cursor over the control as the
 * chart tooltips do. With no cursor, on keyboard focus or a tap, it sits beside the control, below it or
 * above when there is no room, as `IconTooltip` does
 *
 * Pass `shownById` when the page already prints the reason in an element with that id. The control is
 * then described by that element, and no hidden copy is added for a screen reader to read twice.
 *
 * Give the control `controlProps` and no `disabled` attribute, route its click through
 * `handleBlockedClick` while `isUnavailable`, and draw `tooltip` beside it. The reason shows under the
 * cursor, on keyboard focus and on a tap, where it stays until the next tap elsewhere. Escape and a
 * scroll put it away. A control with no reason is left as it is, so a control held off only while its
 * own request runs keeps the native `disabled` and shows nothing
 */
export function useDisabledReason(reason: string | null | undefined, shownById?: string) {
  const activeReason = reason || null
  const ownDescriptionId = useId()
  // A reason already printed on the page is described by that line, not read a second time
  const descriptionId = shownById ?? ownDescriptionId
  const prefersReducedMotion = useReducedMotion()
  const originRef = useRef<HTMLElement | null>(null)
  const [isPinned, setIsPinned] = useState(false)
  // Whether the reason was last placed from the control's edge, as for keyboard focus or a tap, in place of
  // from a pointer over it. Only then is it drawn clear of the control's own box, beside it
  const placedBesideRef = useRef(false)
  const getKeepClear = useCallback(
    () => (placedBesideRef.current ? originRef.current?.getBoundingClientRect() : undefined),
    [],
  )
  const {
    tooltipRef,
    tooltipItem,
    tooltipVisible,
    updateTooltipPosition,
    showTooltip,
    replaceTooltipItem,
    hideTooltip,
    handleTooltipTransitionEnd,
  } = useCursorTooltip<string>({
    originRef,
    xProperty: TOOLTIP_X_PROPERTY,
    yProperty: TOOLTIP_Y_PROPERTY,
    getItemKey: getReasonKey,
    getBounds: getViewportBounds,
    getKeepClear,
  })

  function dismiss() {
    setIsPinned(false)
    hideTooltip()
  }

  function reveal(element: HTMLElement, pointer: { clientX: number; clientY: number }, beside = false) {
    originRef.current = element
    placedBesideRef.current = beside
    showTooltip(activeReason, pointer)
  }

  // Put away when the control stops being unavailable, so a reason from before never shows again
  const [seenReason, setSeenReason] = useState(activeReason)
  if (seenReason !== activeReason) {
    setSeenReason(activeReason)
    if (!activeReason) {
      setIsPinned(false)
      hideTooltip()
    }
  }

  // A reason that changes to another while it shows, such as a form moving on to its next unmet rule,
  // is read afresh, so the tooltip never states a reason that no longer holds
  useEffect(() => {
    if (tooltipVisible && activeReason) replaceTooltipItem(activeReason)
  }, [activeReason, replaceTooltipItem, tooltipVisible])

  // While it shows, a press anywhere else puts it away, and a scroll moves the control from under it
  useEffect(() => {
    if (!tooltipVisible) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      if (originRef.current?.contains(event.target as Node)) return
      setIsPinned(false)
      hideTooltip()
    }
    const handleScroll = () => {
      const origin = originRef.current
      if (origin && document.activeElement === origin) {
        updateTooltipPosition(...anchorPoint(origin))
        return
      }
      setIsPinned(false)
      hideTooltip()
    }

    // Escape puts away a tooltip shown by hover as well as one shown by focus. Only the tooltip goes,
    // not the dialog the control sits in, so it is caught before the dialog sees it
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setIsPinned(false)
      hideTooltip()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [hideTooltip, tooltipVisible, updateTooltipPosition])

  /**
   * Stops the click of an unavailable control reaching its action, and shows the reason to someone who
   * can't hover: a touch, or a key press on the focused control
   */
  function handleBlockedClick(event: ReasonEvent) {
    event.preventDefault()
    event.stopPropagation()
    const canHover = window.matchMedia('(hover: hover)').matches
    const byKeyboard = event.detail === 0
    if (canHover && !byKeyboard) return

    reveal(event.currentTarget, getReasonAnchor(event.currentTarget.getBoundingClientRect()), true)
    setIsPinned(true)
  }

  const controlProps: DisabledReasonControlProps = activeReason
    ? {
        'aria-disabled': true,
        'aria-describedby': descriptionId,
        onMouseEnter: (event) => reveal(event.currentTarget, event),
        onMouseMove: (event) => {
          if (prefersReducedMotion && tooltipVisible) return
          reveal(event.currentTarget, event)
        },
        onMouseLeave: () => {
          if (!isPinned) hideTooltip()
        },
        onFocus: (event) => {
          if (!event.currentTarget.matches(':focus-visible')) return
          reveal(event.currentTarget, getReasonAnchor(event.currentTarget.getBoundingClientRect()), true)
        },
        onBlur: dismiss,
      }
    : {}

  const tooltip: ReactNode = activeReason && (
    <>
      {/* Hidden, not `sr-only`: a screen reader still reads a hidden element named by `aria-describedby`,
          and an absolutely positioned one would escape a scrolling table's clip and widen the page */}
      {!shownById && (
        <span id={descriptionId} hidden>
          {activeReason}
        </span>
      )}
      <CursorTooltipPortal
        ref={tooltipRef}
        testId="disabled-reason-tooltip"
        className="w-max"
        onTransitionEnd={handleTooltipTransitionEnd}
        style={{
          ...(prefersReducedMotion ? REDUCED_MOTION_STYLE : null),
          opacity: tooltipVisible ? 1 : 0,
          transform: `translate3d(var(${TOOLTIP_X_PROPERTY}, 0px), var(${TOOLTIP_Y_PROPERTY}, 0px), 0)`,
        }}
      >
        {tooltipItem && (
          <span aria-hidden className="block max-w-72 text-left text-pretty" style={{ color: 'var(--app-text)' }}>
            {tooltipItem}
          </span>
        )}
      </CursorTooltipPortal>
    </>
  )

  return {
    isUnavailable: activeReason !== null,
    descriptionId,
    controlProps,
    handleBlockedClick,
    tooltip,
  }
}

function anchorPoint(element: HTMLElement): [number, number] {
  const { clientX, clientY } = getReasonAnchor(element.getBoundingClientRect())
  return [clientX, clientY]
}
