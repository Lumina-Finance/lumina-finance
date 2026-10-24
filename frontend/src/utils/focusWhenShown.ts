/**
 * Ref callback that moves focus to its element when the element mounts, for a view that replaces
 * the control that held focus
 *
 * Replacing a focused button drops focus to the page, so a keyboard or screen reader user would be
 * left at the top of the document. The element needs tabIndex={-1} to take focus. A mounting view
 * is the signal, since a view that waits for an exit animation mounts after the state changes
 */
export const focusWhenShown = (element: HTMLElement | null) => {
  element?.focus({ preventScroll: true })
}
