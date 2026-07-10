const OIDC_INTENT_KEY = 'oidc-signed-in-intent'

/** What a signed-in provider roundtrip is for, so the callback page knows how to finish it */
export type OidcSignedInIntent = 'link' | 'reauth'

/**
 * Records why a signed-in user is being sent to a provider, so the callback page routes the return
 * to the matching step. A full-page redirect tears down the app, so this session-scoped flag is what
 * survives the trip out to the provider and back
 */
export function markOidcIntent(intent: OidcSignedInIntent): void {
  sessionStorage.setItem(OIDC_INTENT_KEY, intent)
}

/**
 * Reads and clears the signed-in intent, defaulting to a link since that is the original flow
 */
export function consumeOidcIntent(): OidcSignedInIntent {
  const intent = sessionStorage.getItem(OIDC_INTENT_KEY)
  sessionStorage.removeItem(OIDC_INTENT_KEY)
  return intent === 'reauth' ? 'reauth' : 'link'
}
