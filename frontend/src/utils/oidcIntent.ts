import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'

const OIDC_INTENT_KEY = 'oidc-signed-in-intent'

/** What a passwordless account resumes once its reauth step-up completes */
export type OidcReauthAction =
  | { kind: 'set-password' }
  | { kind: 'link'; slug: string }
  | { kind: 'unlink'; identityId: string }

/**
 * Why a signed-in provider roundtrip was started, so the callback page knows how to finish it. A link
 * roundtrip completes a link directly, while a reauth roundtrip arms the step-up proof and then
 * resumes the pending action
 */
export type OidcSignedInIntent = { flow: 'link' } | { flow: 'reauth'; action: OidcReauthAction }

/**
 * Records why a signed-in user is being sent to a provider, so the callback page routes the return to
 * the matching step. A full-page redirect tears down the app, so this session-scoped flag is what
 * survives the trip out to the provider and back
 *
 * Returns false where the browser blocks storage. The callback reads a return with no flag as a link, so
 * any other flow stops before leaving the app rather than failing once it is back
 */
export function markOidcIntent(intent: OidcSignedInIntent): boolean {
  return writeStoredValue(OIDC_INTENT_KEY, JSON.stringify(intent), 'session')
}

/**
 * Reads and clears the signed-in intent, returning null when none was set, as for an anonymous sign-in
 */
export function consumeOidcIntent(): OidcSignedInIntent | null {
  const raw = readStoredValue(OIDC_INTENT_KEY, 'session')
  removeStoredValue(OIDC_INTENT_KEY, 'session')
  if (!raw) return null
  try {
    return JSON.parse(raw) as OidcSignedInIntent
  } catch {
    return null
  }
}
