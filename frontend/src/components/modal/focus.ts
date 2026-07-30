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
 * Requests focus for the first enabled modal field after the modal panel mounts
 */
export function requestFirstModalFieldFocus(panel: HTMLElement) {
  return window.requestAnimationFrame(() => {
    getModalFieldTabStops(panel)[0]?.focus({ preventScroll: true })
  })
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
 * Filters out responsive-hidden fields while preserving visually layered inputs like mobile date
 */
function isVisibleElement(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return element.getClientRects().length > 0
}
