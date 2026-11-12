import { useEffect, useRef, type RefObject } from 'react'
import { findScrollableAncestor } from '@/components/modal/scrollArea'

/**
 * Holds the page still behind a full-screen modal without overflow: hidden, which would strip a
 * sticky toolbar back to its in-flow position. A drag is allowed only when it lands on a scrollable
 * element inside the modal that can still move in the drag direction. Everything else is blocked,
 * including the boundary over-scroll that iOS would otherwise chain through to the page even with
 * overscroll-contain
 */
export function useModalScrollGuard<T extends HTMLElement>(panelRef: RefObject<T | null>, isOpen: boolean) {
  const touchStartY = useRef(0)

  useEffect(() => {
    if (!isOpen) return undefined

    function recordTouchStart(event: TouchEvent) {
      touchStartY.current = event.touches[0]?.clientY ?? 0
    }

    function blockPageScroll(event: TouchEvent) {
      const panel = panelRef.current
      const target = event.target as Node | null
      if (!panel || !target || !panel.contains(target)) {
        event.preventDefault()
        return
      }

      const scroller = findScrollableAncestor(target, panel)
      if (!scroller) {
        event.preventDefault()
        return
      }

      // Positive delta means the finger moved down, which scrolls the content toward its top edge
      const deltaY = (event.touches[0]?.clientY ?? 0) - touchStartY.current
      const isAtTop = scroller.scrollTop <= 0
      const isAtBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight
      if ((isAtTop && deltaY > 0) || (isAtBottom && deltaY < 0)) event.preventDefault()
    }

    document.addEventListener('touchstart', recordTouchStart, { passive: true })
    document.addEventListener('touchmove', blockPageScroll, { passive: false })
    return () => {
      document.removeEventListener('touchstart', recordTouchStart)
      document.removeEventListener('touchmove', blockPageScroll)
    }
  }, [isOpen, panelRef])
}
