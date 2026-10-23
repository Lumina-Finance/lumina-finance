/**
 * What the import page is given by the page that opened it, kept in the browser's history entry so a
 * reload of the import page still knows where to lead back to
 */
export type ImportOriginState = { importOrigin: string }

// A stand-in for this app's own origin, which an address read against it keeps only when it names a
// page of the app rather than another site. The reserved .invalid name can never be a real site
const ADDRESS_CHECK_ORIGIN = 'https://app.invalid'

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
  if (typeof importOrigin !== 'string' || !importOrigin.startsWith('/')) return null
  // Read the way the browser reads an address, which takes a backslash as a slash and drops tabs and
  // line breaks, so "/\evil.example" and "/\t/evil.example" both name another site as "//" does
  // An address the browser can't read at all, such as "/\[", names no page here either
  try {
    const isAppPath = new URL(importOrigin, ADDRESS_CHECK_ORIGIN).origin === ADDRESS_CHECK_ORIGIN
    return isAppPath ? importOrigin : null
  } catch {
    return null
  }
}
