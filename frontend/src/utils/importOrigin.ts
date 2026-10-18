/**
 * What the import page is given by the page that opened it, kept in the browser's history entry so a
 * reload of the import page still knows where to lead back to
 */
export type ImportOriginState = { importOrigin: string }

/**
 * The router state an opener passes to the import page, naming the address it is opening from
 */
export function buildImportOriginState(origin: { pathname: string; search: string }): ImportOriginState {
  return { importOrigin: `${origin.pathname}${origin.search}` }
}

/**
 * Reads the address the import page was opened from, or null for a direct visit or a link
 */
export function readImportOrigin(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('importOrigin' in state)) return null
  const { importOrigin } = state
  // A double slash would read as another site's address rather than a page of this app
  const isAppPath = typeof importOrigin === 'string' && importOrigin.startsWith('/') && !importOrigin.startsWith('//')
  return isAppPath ? importOrigin : null
}
