import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useReducedMotion } from 'motion/react'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { useCursorTooltip } from '@/hooks/useCursorTooltip'
import { getClippingBoxes, getReasonAnchor, getViewportBounds, isBoxInView } from '@/utils/disabledReasonAnchor'

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
 * cursor, on keyboard focus and on a tap, where it stays until the next tap elsewhere. Escape puts it
 * away. A scroll puts it away too, except that a focused control in view keeps it, moved along with the control. A control with no reason is left as it is, so a control held off only while its
 * own request runs keeps the native `disabled` and shows nothing
 */
export function useDisabledReason(
  reason: string | null | undefined,
  shownById?: string,
  keepClearOf?: RefObject<HTMLElement | null>,
) {
  return useControlTooltip(reason, { shownById, keepClearOf })
}

/**
 * Explains what a control does, in the tooltip a disabled control's reason uses, for a control that is
 * available
 *
 * It shows under a mouse pointer and on keyboard focus, never on a touch, where a hover is only the
 * echo of a tap. It never marks the control `aria-disabled` or blocks its click, and the tooltip lets
 * every pointer through, so a press always reaches the control. Give the control `controlProps` and
 * draw `tooltip` beside it. The control's name stays on its own `aria-label` or text
 *
 * Pass no hint while the control shows a disabled reason of its own, so the two never stack
 */
export function useControlHint(hint: string | null | undefined) {
  const { controlProps, tooltip } = useControlTooltip(hint, { advisory: true })
  return { controlProps, tooltip }
}

type ControlTooltipOptions = {
  shownById?: string
  keepClearOf?: RefObject<HTMLElement | null>

  // The text only explains a control that works, so the control stays enabled, a click is never held
  // back, and a pointer that can't hover shows nothing
  advisory?: boolean
}

function useControlTooltip(
  reason: string | null | undefined,
  { shownById, keepClearOf, advisory = false }: ControlTooltipOptions,
) {
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
  // Another box the reason must not cover, such as a line printed above the control. The reason then
  // hangs clear of the control and that box together, whether it was placed from the pointer or from
  // the control's edge. The box widens the control's only upward or downward, so the reason stays
  // level with the control
  const keepClearOfRef = useRef(keepClearOf)
  useEffect(() => {
    keepClearOfRef.current = keepClearOf
  }, [keepClearOf])
  const getKeepClear = useCallback(() => {
    const control = originRef.current?.getBoundingClientRect()
    const other = keepClearOfRef.current?.current?.getBoundingClientRect()
    if (control && other) {
      const top = Math.min(control.top, other.top)
      return new DOMRect(control.left, top, control.width, Math.max(control.bottom, other.bottom) - top)
    }
    return placedBesideRef.current ? control : undefined
  }, [])
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
    preferAbove: advisory,
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

  function revealBeside(element: HTMLElement) {
    reveal(element, getReasonAnchor(element.getBoundingClientRect()), true)
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
      // A focused control keeps its reason beside it while it is in view. Scrolled out of view, the reason
      // would float over whatever the surface shows in its place
      if (
        origin &&
        document.activeElement === origin &&
        isBoxInView(origin.getBoundingClientRect(), getClippingBoxes(origin))
      ) {
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
      // A hint is only help, so Escape puts it away and still reaches the dialog
      if (!advisory) event.stopPropagation()
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
  }, [advisory, hideTooltip, tooltipVisible, updateTooltipPosition])

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
        ...(advisory ? null : { 'aria-disabled': true, 'aria-describedby': descriptionId }),
        onMouseEnter: (event) => {
          if (!advisory) reveal(event.currentTarget, event)
          // A touch only echoes its tap as a hover, and a hint must not appear under the finger
          else if (window.matchMedia('(hover: hover)').matches) revealBeside(event.currentTarget)
        },
        // A hint hangs from its control and stays put, so a moving pointer has nothing to follow
        onMouseMove: advisory
          ? undefined
          : (event) => {
              if (prefersReducedMotion && tooltipVisible) return
              reveal(event.currentTarget, event)
            },
        onMouseLeave: () => {
          if (!isPinned) hideTooltip()
        },
        onFocus: (event) => {
          if (!event.currentTarget.matches(':focus-visible')) return
          revealBeside(event.currentTarget)
        },
        onBlur: dismiss,
      }
    : {}

  const tooltip: ReactNode = activeReason && (
    <>
      {/* Hidden, not `sr-only`: a screen reader still reads a hidden element named by `aria-describedby`,
          and an absolutely positioned one would escape a scrolling table's clip and widen the page */}
      {!shownById && !advisory && (
        <span id={descriptionId} hidden>
          {activeReason}
        </span>
      )}
      <CursorTooltipPortal
        ref={tooltipRef}
        testId={advisory ? 'control-hint-tooltip' : 'disabled-reason-tooltip'}
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
