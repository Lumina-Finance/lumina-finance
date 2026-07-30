// The app renders into this element, and every modal portals into the body beside it rather than inside
// it, so marking it inert while a modal is open takes the whole page behind out of the tab order and away
// from screen readers without touching the dialog itself
const APP_ROOT_ID = 'root'

// Tokens for the modals currently open, the top-most last. One stack drives everything that depends on
// that order: which modal Escape closes, and which panels below it stop taking input
const openModalTokens: string[] = []

const stackListeners = new Set<() => void>()

/**
 * Adds a modal to the open stack, taking the page behind out of the tab order for the first one
 */
export function registerOpenModal(token: string) {
  openModalTokens.push(token)
  syncAppRootInert()
  notifyStackListeners()
}

/**
 * Removes a modal from the open stack, giving the page back once the last one closes
 */
export function unregisterOpenModal(token: string) {
  const index = openModalTokens.indexOf(token)
  if (index !== -1) openModalTokens.splice(index, 1)

  syncAppRootInert()
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
 * Marks the app root inert while any modal is open
 */
function syncAppRootInert() {
  const appRoot = document.getElementById(APP_ROOT_ID)
  if (!appRoot) return

  if (openModalTokens.length > 0) appRoot.setAttribute('inert', '')
  else appRoot.removeAttribute('inert')
}

/**
 * Tells every subscribed shell that the stack changed
 */
function notifyStackListeners() {
  stackListeners.forEach((listener) => listener())
}
