import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { applyCursorTooltipPosition } from '@/utils/tooltipPosition'

export type CursorTooltipPointer = {
  clientX: number
  clientY: number
}

type CursorTooltipOptions<TItem, TOrigin extends HTMLElement> = {
  originRef: RefObject<TOrigin | null>
  xProperty: string
  yProperty: string
  getItemKey: (item: TItem) => string | number

  // What holds the tooltip in, in place of the card around the origin. A tooltip for a control that
  // belongs to no card, such as a disabled button, takes the viewport here
  getBounds?: () => DOMRect | undefined

  // A box the tooltip stays off, as a disabled button's own box, so the tooltip never hides its label
  getKeepClear?: () => DOMRect | undefined

  // Rises above the box to keep clear while there is room, as a hint does
  preferAbove?: boolean
}

/**
 * Owns cursor tooltip portal state while callers keep their own item selection rules
 */
export function useCursorTooltip<TItem, TOrigin extends HTMLElement = HTMLElement>({
  originRef,
  xProperty,
  yProperty,
  getItemKey,
  getBounds,
  getKeepClear,
  preferAbove,
}: CursorTooltipOptions<TItem, TOrigin>) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipItem, setTooltipItem] = useState<TItem | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)
  const lastPointerRef = useRef<CursorTooltipPointer | null>(null)

  /**
   * Keeps the portal tooltip aligned to the latest cursor position
   */
  const updateTooltipPosition = useCallback(
    (clientX: number, clientY: number) => {
      lastPointerRef.current = { clientX, clientY }
      const origin = originRef.current
      const tooltip = tooltipRef.current
      if (!origin || !tooltip) return

      applyCursorTooltipPosition({
        origin,
        tooltip,
        clientX,
        clientY,
        xProperty,
        yProperty,
        bounds: getBounds?.(),
        keepClear: getKeepClear?.(),
        preferAbove,
      })
    },
    [getBounds, getKeepClear, preferAbove, originRef, xProperty, yProperty],
  )

  // The first placement is measured before the item has rendered, when the tooltip is empty and a few
  // pixels high, which put a tooltip kept clear of its control back over it. Placed again once the
  // content is in, from the pointer it was last placed for
  useLayoutEffect(() => {
    const pointer = lastPointerRef.current
    if (tooltipItem && pointer) updateTooltipPosition(pointer.clientX, pointer.clientY)
  }, [tooltipItem, updateTooltipPosition])

  const hideTooltip = useCallback(() => {
    setTooltipVisible(false)
  }, [])

  /**
   * Shows the selected tooltip item and repositions after React updates the portal content
   */
  const showTooltip = useCallback(
    (nextItem: TItem | null | undefined, pointer: CursorTooltipPointer) => {
      if (!nextItem) {
        hideTooltip()
        return
      }

      updateTooltipPosition(pointer.clientX, pointer.clientY)
      setTooltipItem((current) => (current && getItemKey(current) === getItemKey(nextItem) ? current : nextItem))
      setTooltipVisible(true)
      requestAnimationFrame(() => updateTooltipPosition(pointer.clientX, pointer.clientY))
    },
    [getItemKey, hideTooltip, updateTooltipPosition],
  )

  /**
   * Swaps the content of a tooltip that is showing for another item, placed again from the last pointer
   */
  const replaceTooltipItem = useCallback((nextItem: TItem) => {
    setTooltipItem(nextItem)
  }, [])

  /**
   * Keeps faded tooltip content mounted until the opacity transition finishes
   */
  const handleTooltipTransitionEnd = useCallback(
    (event: ReactTransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || tooltipVisible) return
      setTooltipItem(null)
    },
    [tooltipVisible],
  )

  return {
    tooltipRef,
    tooltipItem,
    tooltipVisible,
    updateTooltipPosition,
    showTooltip,
    replaceTooltipItem,
    hideTooltip,
    handleTooltipTransitionEnd,
  }
}
