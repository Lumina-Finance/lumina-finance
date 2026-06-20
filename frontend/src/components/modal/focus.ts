const MODAL_FIELD_TAB_STOP_SELECTOR = [
  '[data-modal-field-tab-stop="true"]:not([disabled])',
  'input:not([disabled]):not([type="hidden"]):not([data-dropdown-search="true"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button[role="combobox"]:not([disabled])',
].join(',')

/**
 * Returns enabled modal fields that should receive sequential Tab focus
 */
export function getModalFieldTabStops(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FIELD_TAB_STOP_SELECTOR))
    .filter(isVisibleModalField)
}

/**
 * Gets the next modal field for Tab or Shift+Tab focus wrapping
 */
export function getNextModalFieldTabStop<T>(
  fieldTabStops: readonly T[],
  activeElement: T | null,
  shiftKey: boolean,
) {
  if (fieldTabStops.length === 0) return null

  const activeIndex = activeElement ? fieldTabStops.indexOf(activeElement) : -1

  if (shiftKey) {
    return fieldTabStops[activeIndex <= 0 ? fieldTabStops.length - 1 : activeIndex - 1]
  }

  return fieldTabStops[activeIndex < 0 || activeIndex === fieldTabStops.length - 1 ? 0 : activeIndex + 1]
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
 * Filters out responsive-hidden fields while preserving visually layered inputs like mobile date
 */
function isVisibleModalField(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return element.getClientRects().length > 0
}
