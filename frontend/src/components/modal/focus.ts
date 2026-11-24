import { useEffect, useState, type RefObject } from 'react'
import { findScrollableAncestor } from '@/components/modal/scrollArea'
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
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FIELD_TAB_STOP_SELECTOR)).filter(isVisibleElement)
}

/**
 * Returns every control inside the container that Tab can reach, in the order Tab reaches them
 *
 * A control taken out of the Tab order, such as a date field's calendar icon, is left out as the browser
 * leaves it out, since a dialog that stopped on it would hold focus inside the field it belongs to
 */
export function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.tabIndex >= 0 && isVisibleElement(element),
  )
}

/**
 * Scrolls a body that focus has just moved to a control so the text around that control shows in full: above it
 * its label, and the heading of its section when it is the first control there, and below it a label that wraps
 * past the control, such as a checkbox's. The browser scrolls only the control to the edge and leaves that text
 * cut under the header or the footer. The text keeps the room the body's scroll padding gives the control.
 * `focusable` is the dialogue's Tab order, and the body is found from the control's parent, since a long textarea
 * scrolls itself
 */
export function revealControlText(control: HTMLElement, focusable: readonly HTMLElement[]): void {
  const area = control.parentElement && findScrollableAncestor(control.parentElement, document.body)
  if (!area) return

  const style = window.getComputedStyle(area)
  const topPadding = parseFloat(style.scrollPaddingTop) || 0
  const bottomPadding = parseFloat(style.scrollPaddingBottom) || 0
  const label = (control as HTMLInputElement).labels?.[0] ?? control.closest('label')

  const section = control.closest('section')
  const top = control.getBoundingClientRect().top
  const opensSection =
    section !== null &&
    !focusable.some(
      (other) => other !== control && section.contains(other) && other.getBoundingClientRect().top < top - 1,
    )
  const aboveTops = [label, opensSection ? section : null].flatMap((element) =>
    element ? [element.getBoundingClientRect().top] : [],
  )
  if (aboveTops.length > 0) {
    // Never so far that the control reaches the bottom padding, where a footer over the body covers it
    const shortBy = area.getBoundingClientRect().top + topPadding - Math.min(...aboveTops)
    const room = area.getBoundingClientRect().bottom - bottomPadding - control.getBoundingClientRect().bottom
    if (shortBy > 0) area.scrollTop -= Math.min(shortBy, Math.max(room, 0))
  }

  // Never so far that the control reaches the top padding
  const reach = Math.max(control.getBoundingClientRect().bottom, label?.getBoundingClientRect().bottom ?? 0)
  const below = reach - (area.getBoundingClientRect().bottom - bottomPadding)
  const roomAbove = control.getBoundingClientRect().top - (area.getBoundingClientRect().top + topPadding)
  if (below > 0) area.scrollTop += Math.min(below, Math.max(roomAbove, 0))
}

/**
 * Gets the next stop for Tab or Shift+Tab focus wrapping
 */
export function getNextTabStop<T>(tabStops: readonly T[], activeElement: T | null, shiftKey: boolean) {
  if (tabStops.length === 0) return null

  const activeIndex = activeElement ? tabStops.indexOf(activeElement) : -1

  if (shiftKey) {
    return tabStops[activeIndex <= 0 ? tabStops.length - 1 : activeIndex - 1]
  }

  return tabStops[activeIndex < 0 || activeIndex === tabStops.length - 1 ? 0 : activeIndex + 1]
}

// A control a dialog names to open on instead of its first field, such as Cancel in a delete confirmation
const MODAL_INITIAL_FOCUS_SELECTOR = '[data-modal-initial-focus="true"]:not([disabled])'

// A part of a dialogue whose fields are never the one it opens on, such as a field held with its reason,
// where focus would open the reason over the form
const MODAL_SKIPPED_INITIAL_FOCUS_SELECTOR = '[data-modal-skip-initial-focus]'

/**
 * Picks where focus goes once the panel has mounted: a control or field the dialogue marks with
 * `data-modal-initial-focus`, then its first field, so a form opens ready to type in, passing over any
 * field inside a part marked with `data-modal-skip-initial-focus`. Falls back to the panel itself so a
 * dialogue with no fields still takes focus off the page behind
 */
export function getInitialModalFocusTarget(panel: HTMLElement): HTMLElement {
  return (
    panel.querySelector<HTMLElement>(MODAL_INITIAL_FOCUS_SELECTOR) ??
    getModalFieldTabStops(panel).find((field) => !field.closest(MODAL_SKIPPED_INITIAL_FOCUS_SELECTOR)) ??
    panel
  )
}

/**
 * Moves focus into the panel once it has mounted, to where `getInitialModalFocusTarget` picks
 */
export function requestInitialModalFocus(panel: HTMLElement) {
  return window.requestAnimationFrame(() => {
    getInitialModalFocusTarget(panel).focus({ preventScroll: true })
  })
}

// Read during render as well as in the effect, so a render with no document, as in a static markup test,
// reads no control
function readFocusedControl() {
  if (typeof document === 'undefined') return null
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
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

  // The control focused as the dialogue opens is read while rendering, because a field in the panel that
  // takes focus as it mounts has done so by the time an effect runs, and would be taken for the opener
  const [wasOpen, setWasOpen] = useState(open)
  // A dialogue mounted already open, such as one remounted through its key, reads it on its first render
  const [focusedOnOpen, setFocusedOnOpen] = useState<HTMLElement | null>(() => (open ? readFocusedControl() : null))
  if (open !== wasOpen) {
    setWasOpen(open)
    setFocusedOnOpen(open ? readFocusedControl() : null)
  }

  // Return focus to the opener once the dialogue closes, or to the fallback if the opener has gone
  useEffect(() => {
    if (!open) return

    const opener = returnFocusOpener ?? focusedOnOpen ?? readFocusedControl()
    const fallback = fallbackRef?.current

    return () => {
      // A covered dialog remains inert until React renders the stack change
      window.requestAnimationFrame(() => {
        const target = opener?.isConnected && opener !== document.body ? opener : fallback
        if (target?.isConnected) target.focus({ preventScroll: true })
      })
    }
  }, [open, returnFocusOpener, focusedOnOpen, fallbackRef])

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    if (!panel) return

    const frameId = requestInitialModalFocus(panel)
    return () => window.cancelAnimationFrame(frameId)
  }, [open, panelRef])

  useEffect(() => {
    if (!open || closeDisabled || !onClose) return

    // One press closes one layer. The layer that takes the key marks it as handled, so the dialogue under it, whose
    // listener can run after the top layer has closed and left the stack, does not take the same press as its own
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (!isTopMostModal(token) || isFloatingLayerOpen()) return
      event.preventDefault()
      onClose()
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
      const next = getNextTabStop(focusable, from, event.shiftKey)
      next?.focus()
      if (next) revealControlText(next, focusable)
    }

    // A child cannot suppress Tab before the dialog keeps focus inside it
    document.addEventListener('keydown', holdFocusInPanel, true)
    return () => document.removeEventListener('keydown', holdFocusInPanel, true)
  }, [open, panelRef, token])
}

/**
 * Filters out responsive-hidden fields while preserving visually layered inputs like mobile date. A control inside
 * something inert, such as a closed filter panel's body, can't take focus, so Tab must not stop on it
 */
function isVisibleElement(element: HTMLElement) {
  if (element.closest('[inert]')) return false

  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return element.getClientRects().length > 0
}
