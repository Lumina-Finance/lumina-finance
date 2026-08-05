import {
  useCallback,
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
}

/**
 * Owns cursor tooltip portal state while callers keep their own item selection rules
 */
export function useCursorTooltip<TItem, TOrigin extends HTMLElement = HTMLElement>({
  originRef,
  xProperty,
  yProperty,
  getItemKey,
}: CursorTooltipOptions<TItem, TOrigin>) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [tooltipItem, setTooltipItem] = useState<TItem | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)

  /**
   * Keeps the portal tooltip aligned to the latest cursor position
   */
  const updateTooltipPosition = useCallback((clientX: number, clientY: number) => {
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
    })
  }, [originRef, xProperty, yProperty])

  const hideTooltip = useCallback(() => {
    setTooltipVisible(false)
  }, [])

  /**
   * Shows the selected tooltip item and repositions after React updates the portal content
   */
  const showTooltip = useCallback((nextItem: TItem | null | undefined, pointer: CursorTooltipPointer) => {
    if (!nextItem) {
      hideTooltip()
      return
    }

    updateTooltipPosition(pointer.clientX, pointer.clientY)
    setTooltipItem((current) => (
      current && getItemKey(current) === getItemKey(nextItem) ? current : nextItem
    ))
    setTooltipVisible(true)
    requestAnimationFrame(() => updateTooltipPosition(pointer.clientX, pointer.clientY))
  }, [getItemKey, hideTooltip, updateTooltipPosition])

  /**
   * Keeps faded tooltip content mounted until the opacity transition finishes
   */
  const handleTooltipTransitionEnd = useCallback((event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || tooltipVisible) return
    setTooltipItem(null)
  }, [tooltipVisible])

  return {
    tooltipRef,
    tooltipItem,
    tooltipVisible,
    updateTooltipPosition,
    showTooltip,
    hideTooltip,
    handleTooltipTransitionEnd,
  }
}
