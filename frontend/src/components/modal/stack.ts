// The app renders into this element, and every modal portals into the body beside it rather than inside
// it, so marking it inert while a modal is open takes the whole page behind out of the tab order and away
// from screen readers without touching the dialog itself
const APP_ROOT_ID = 'root'

// Marks the page while a blurring modal is open, so the stylesheet can blur what sits behind it. The
// full-screen filter sheet keeps the page inert without this blur because its solid surface hides it
const PAGE_BEHIND_MODAL_CLASS = 'app-behind-modal'

// Tokens for the modals currently open, the top-most last. One stack drives everything that depends on
// that order: which modal Escape closes, and which panels below it stop taking input
const openModalLayers: { token: string; blurPage: boolean; inertPage: boolean }[] = []

const stackListeners = new Set<() => void>()

/**
 * Adds a dialog to the open stack with its own page blur and inert policy
 */
export function registerOpenModal(token: string, { blurPage = true, inertPage = true } = {}) {
  openModalLayers.push({ token, blurPage, inertPage })
  syncPageBehindModals()
  notifyStackListeners()
}

/**
 * Removes a modal from the open stack, giving the page back once the last one closes
 */
export function unregisterOpenModal(token: string) {
  const index = openModalLayers.findIndex((layer) => layer.token === token)
  if (index !== -1) openModalLayers.splice(index, 1)

  syncPageBehindModals()
  notifyStackListeners()
}

/**
 * Reports whether a modal is the top-most one open, so a keypress reaches only that one
 */
export function isTopMostModal(token: string) {
  return openModalLayers[openModalLayers.length - 1]?.token === token
}

/**
 * Reports whether another modal is open on top of this one. A token that has not registered yet counts as
 * uncovered, so a panel is never inert on its first paint, before its own effects have run
 */
export function isModalCovered(token: string) {
  const index = openModalLayers.findIndex((layer) => layer.token === token)

  return index !== -1 && index < openModalLayers.length - 1
}

/**
 * Subscribes to stack changes so an open shell re-renders when a modal opens or closes above it
 */
export function subscribeToModalStack(listener: () => void) {
  stackListeners.add(listener)

  return () => {
    stackListeners.delete(listener)
  }
}

/**
 * Applies page blur and inert only when an open dialog requests each effect
 */
function syncPageBehindModals() {
  const appRoot = document.getElementById(APP_ROOT_ID)
  if (!appRoot) return

  appRoot.toggleAttribute('inert', openModalLayers.some((layer) => layer.inertPage))
  appRoot.classList.toggle(PAGE_BEHIND_MODAL_CLASS, openModalLayers.some((layer) => layer.blurPage))
}

/**
 * Tells every subscribed shell that the stack changed
 */
function notifyStackListeners() {
  stackListeners.forEach((listener) => listener())
}
