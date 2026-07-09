import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  getModalFieldTabStops,
  getNextModalFieldTabStop,
  requestFirstModalFieldFocus,
} from '@/components/modal/focus'

// Native inputs that expose internal date/time segments the browser tabs through on its own
const SEGMENTED_INPUT_TYPES = new Set(['date', 'datetime-local', 'time', 'month', 'week'])

/**
 * Reports whether an element is a native date or time input with internal segments
 */
function isSegmentedInput(element: EventTarget | null): element is HTMLInputElement {
  return element instanceof HTMLInputElement && SEGMENTED_INPUT_TYPES.has(element.type)
}

/**
 * Provides the modal panel ref and Tab handler that keep keyboard focus on field controls
 */
export function useModalFieldFocus<T extends HTMLElement = HTMLDivElement>(open = true) {
  const panelRef = useRef<T>(null)

  // Marks a Tab that may exit a date input so the resulting focus can be redirected to the neighbouring field
  const dateExitRef = useRef<{ backward: boolean } | null>(null)

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    if (!panel) return

    const frameId = requestFirstModalFieldFocus(panel)

    return () => window.cancelAnimationFrame(frameId)
  }, [open])

  /**
   * Redirects focus to the neighbouring field when the browser tabs out of a date input onto a
   * decorative control that is not part of the modal field order, such as a tooltip or icon button
   */
  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    if (!panel) return

    const handleFocusIn = (event: FocusEvent) => {
      const exit = dateExitRef.current
      if (!exit) return
      dateExitRef.current = null

      // A segment move keeps focus on the same input, so a real exit is one that left the date input behind
      if (!isSegmentedInput(event.relatedTarget)) return

      const fieldTabStops = getModalFieldTabStops(panel)
      const landing = event.target instanceof HTMLElement ? event.target : null
      if (landing && fieldTabStops.includes(landing)) return

      const nextField = getNextModalFieldTabStop(fieldTabStops, event.relatedTarget, exit.backward)
      nextField?.focus()
    }

    panel.addEventListener('focusin', handleFocusIn)

    return () => panel.removeEventListener('focusin', handleFocusIn)
  }, [open])

  /**
   * Keeps sequential Tab focus on modal fields while leaving action buttons pointer-accessible
   */
  const handleModalFieldKeyDown = useCallback((event: ReactKeyboardEvent<T>) => {
    if (event.key !== 'Tab') return

    const panel = panelRef.current
    if (!panel) return

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Let the browser walk a date input's internal year, month, and day segments, then redirect the
    // exit through focusin so it lands on the next field rather than an adjacent decorative control
    if (isSegmentedInput(activeElement)) {
      dateExitRef.current = { backward: event.shiftKey }
      window.requestAnimationFrame(() => {
        dateExitRef.current = null
      })
      return
    }

    const fieldTabStops = getModalFieldTabStops(panel)
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
