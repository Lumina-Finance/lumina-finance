import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  getModalFieldTabStops,
  getNextModalFieldTabStop,
  requestFirstModalFieldFocus,
} from '@/components/modal/focus'

/**
 * Provides the modal panel ref and Tab handler that keep keyboard focus on field controls
 */
export function useModalFieldFocus<T extends HTMLElement = HTMLDivElement>(open = true) {
  const panelRef = useRef<T>(null)

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    if (!panel) return

    const frameId = requestFirstModalFieldFocus(panel)

    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  /**
   * Keeps sequential Tab focus on modal fields while leaving action buttons pointer-accessible
   */
  const handleModalFieldKeyDown = useCallback((event: ReactKeyboardEvent<T>) => {
    if (event.key !== 'Tab') return

    const panel = panelRef.current
    if (!panel) return

    const fieldTabStops = getModalFieldTabStops(panel)
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const nextField = getNextModalFieldTabStop(fieldTabStops, activeElement, event.shiftKey)

    if (!nextField) {
      event.preventDefault()
      return
    }

    event.preventDefault()
    nextField.focus()
  }, [])

  return { panelRef, handleModalFieldKeyDown }
}
