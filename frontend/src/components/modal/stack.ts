// The app renders into this element, and every modal portals into the body beside it rather than inside
// it, so marking it inert while a modal is open takes the whole page behind out of the tab order and away
// from screen readers without touching the dialog itself
const APP_ROOT_ID = 'root'

// Marks the page while any modal is open, so the stylesheet can blur what sits behind the dialog. The
// blur belongs on the page rather than on a filter laid over it: the page is inert and scroll locked
// for as long as a modal is open, so the browser rasterizes it once, where a filter over it has to run
// again for every frame in which anything above it moves
const PAGE_BEHIND_MODAL_CLASS = 'app-behind-modal'

// Tokens for the modals currently open, the top-most last. One stack drives everything that depends on
// that order: which modal Escape closes, and which panels below it stop taking input
const openModalTokens: string[] = []

const stackListeners = new Set<() => void>()

/**
 * Adds a modal to the open stack, taking the page behind out of the tab order for the first one
 */
export function registerOpenModal(token: string) {
  openModalTokens.push(token)
  syncPageBehindModals()
  notifyStackListeners()
}

/**
 * Removes a modal from the open stack, giving the page back once the last one closes
 */
export function unregisterOpenModal(token: string) {
  const index = openModalTokens.indexOf(token)
  if (index !== -1) openModalTokens.splice(index, 1)

  syncPageBehindModals()
  notifyStackListeners()
}

/**
 * Reports whether a modal is the top-most one open, so a keypress reaches only that one
 */
export function isTopMostModal(token: string) {
  return openModalTokens[openModalTokens.length - 1] === token
}

/**
 * Reports whether another modal is open on top of this one. A token that has not registered yet counts as
 * uncovered, so a panel is never inert on its first paint, before its own effects have run
 */
export function isModalCovered(token: string) {
  const index = openModalTokens.indexOf(token)

  return index !== -1 && index < openModalTokens.length - 1
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
 * Marks the app root inert and blurred while any modal is open
 */
function syncPageBehindModals() {
  const appRoot = document.getElementById(APP_ROOT_ID)
  if (!appRoot) return

  const anyModalOpen = openModalTokens.length > 0
  appRoot.toggleAttribute('inert', anyModalOpen)
  appRoot.classList.toggle(PAGE_BEHIND_MODAL_CLASS, anyModalOpen)
}

/**
 * Tells every subscribed shell that the stack changed
 */
function notifyStackListeners() {
  stackListeners.forEach((listener) => listener())
}
