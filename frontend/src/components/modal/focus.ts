import { useEffect, type RefObject } from 'react'
import { isTopMostModal } from '@/components/modal/stack'
import { isFloatingLayerOpen, isInsideFloatingLayer } from '@/utils/floatingLayer'

const MODAL_FIELD_TAB_STOP_SELECTOR = [
  '[data-modal-field-tab-stop="true"]:not([disabled])',
  'input:not([disabled]):not([type="hidden"]):not([data-dropdown-search="true"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button[role="combobox"]:not([disabled])',
].join(',')

// Everything the browser will focus with Tab, which is what a dialog has to cycle through: the fields
// above plus the actions a keyboard user needs to finish or abandon the dialog
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Returns enabled modal fields that should receive sequential Tab focus
 */
export function getModalFieldTabStops(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FIELD_TAB_STOP_SELECTOR))
    .filter(isVisibleElement)
}

/**
 * Returns every control inside the container that Tab can reach, in the order Tab reaches them
 */
export function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(isVisibleElement)
}

/**
 * Gets the next stop for Tab or Shift+Tab focus wrapping
 */
export function getNextTabStop<T>(
  tabStops: readonly T[],
  activeElement: T | null,
  shiftKey: boolean,
) {
  if (tabStops.length === 0) return null

  const activeIndex = activeElement ? tabStops.indexOf(activeElement) : -1

  if (shiftKey) {
    return tabStops[activeIndex <= 0 ? tabStops.length - 1 : activeIndex - 1]
  }

  return tabStops[activeIndex < 0 || activeIndex === tabStops.length - 1 ? 0 : activeIndex + 1]
}

/**
 * Moves focus into the panel once it has mounted, preferring its first field so a form opens ready to type
 * in, and falling back to the panel itself so a dialog with no fields still takes focus off the page behind
 */
export function requestInitialModalFocus(panel: HTMLElement) {
  return window.requestAnimationFrame(() => {
    const target = getModalFieldTabStops(panel)[0] ?? panel
    target.focus({ preventScroll: true })
  })
}

/**
 * Keeps keyboard focus and Escape handling on the top dialog, including the full-screen filter sheet
 */
export function useDialogFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  token: string,
  onClose?: () => void,
  closeDisabled = false,
  returnFocus?: { opener: HTMLElement | null; fallbackRef: RefObject<HTMLElement | null> },
) {
  const returnFocusOpener = returnFocus?.opener
  const fallbackRef = returnFocus?.fallbackRef

  // Capture the opener before moving focus into the dialog
  useEffect(() => {
    if (!open) return

    const opener = returnFocusOpener
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    const fallback = fallbackRef?.current

    return () => {
      // A covered dialog remains inert until React renders the stack change
      window.requestAnimationFrame(() => {
        const target = opener?.isConnected && opener !== document.body ? opener : fallback
        if (target?.isConnected) target.focus({ preventScroll: true })
      })
    }
  }, [open, returnFocusOpener, fallbackRef])

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    if (!panel) return

    const frameId = requestInitialModalFocus(panel)
    return () => window.cancelAnimationFrame(frameId)
  }, [open, panelRef])

  useEffect(() => {
    if (!open || closeDisabled || !onClose) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTopMostModal(token) && !isFloatingLayerOpen()) onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeDisabled, onClose, open, token])

  useEffect(() => {
    if (!open) return

    const holdFocusInPanel = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !isTopMostModal(token)) return
      if (isInsideFloatingLayer(document.activeElement)) return

      const panel = panelRef.current
      if (!panel) return

      event.preventDefault()

      const focusable = getFocusableElements(panel)
      if (focusable.length === 0) {
        panel.focus({ preventScroll: true })
        return
      }

      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const from = active && panel.contains(active) ? active : null
      getNextTabStop(focusable, from, event.shiftKey)?.focus()
    }

    // A child cannot suppress Tab before the dialog keeps focus inside it
    document.addEventListener('keydown', holdFocusInPanel, true)
    return () => document.removeEventListener('keydown', holdFocusInPanel, true)
  }, [open, panelRef, token])
}

/**
 * Filters out responsive-hidden fields while preserving visually layered inputs like mobile date
 */
function isVisibleElement(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return element.getClientRects().length > 0
}
