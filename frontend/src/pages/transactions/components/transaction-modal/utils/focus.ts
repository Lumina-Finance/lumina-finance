const FIELD_TAB_STOP_SELECTOR = [
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button[role="combobox"]:not([disabled])',
].join(',')

/**
 * Returns enabled transaction modal fields that should receive sequential Tab focus
 */
export function getTransactionModalFieldTabStops(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FIELD_TAB_STOP_SELECTOR))
    .filter(isVisibleTransactionModalField)
}

/**
 * Gets the next transaction modal field for Tab or Shift+Tab focus wrapping
 */
export function getNextTransactionModalFieldTabStop<T>(
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
 * Filters out responsive-hidden fields while preserving visually layered inputs like mobile date
 */
function isVisibleTransactionModalField(element: HTMLElement) {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false

  return element.getClientRects().length > 0
}
