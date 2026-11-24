import { readStoredValue, removeStoredValue, writeStoredValue } from '@/utils/browserStorage'

const OIDC_INTENT_KEY = 'oidc-signed-in-intent'

/** What a passwordless account resumes once its reauth step-up completes */
export type OidcReauthAction =
  | { kind: 'set-password' }
  | { kind: 'link'; slug: string }
  | { kind: 'unlink'; identityId: string }
  | { kind: 'end-other-sessions' }
  | { kind: 'change-email'; email: string }
  | { kind: 'delete-profile' }

/**
 * The settings navigation state that tells the matching control to finish an action after its reauth,
 * one flag per action so no action is mistaken for another
 */
export function getReauthResumeState(action: OidcReauthAction) {
  switch (action.kind) {
    case 'set-password':
      return { setPassword: true }
    case 'link':
      return { resumeLink: action.slug }
    case 'unlink':
      return { resumeUnlink: action.identityId }
    case 'end-other-sessions':
      return { resumeEndOtherSessions: true }
    case 'change-email':
      return { resumeChangeEmail: action.email }
    case 'delete-profile':
      return { resumeDeleteProfile: true }
  }
}

/**
 * Why a signed-in provider roundtrip was started, so the callback page knows how to finish it. A link
 * roundtrip completes a link directly, while a reauth roundtrip arms the step-up proof and then
 * resumes the pending action
 */
export type OidcSignedInIntent = { flow: 'link' } | { flow: 'reauth'; action: OidcReauthAction; userId: string }

/**
 * The intent as the signed-in user may use it, or null for one another person's trip left in this
 * browser's session storage. A reauth intent carries the address being changed to, so it is read back
 * only for the user who started it
 */
export function getIntentForUser(intent: OidcSignedInIntent | null, userId: string | null): OidcSignedInIntent | null {
  if (intent?.flow === 'reauth' && intent.userId !== userId) return null
  return intent
}

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
 * Reads the signed-in intent, returning null when none was set, as for an anonymous sign-in. Reading
 * leaves it stored, so a render React throws away before the return is handled can read it again
 */
export function readOidcIntent(): OidcSignedInIntent | null {
  const raw = readStoredValue(OIDC_INTENT_KEY, 'session')
  if (!raw) return null
  try {
    return JSON.parse(raw) as OidcSignedInIntent
  } catch {
    return null
  }
}

/**
 * Clears the signed-in intent once the callback page handles the return, so a later return isn't read
 * with it
 */
export function clearOidcIntent() {
  removeStoredValue(OIDC_INTENT_KEY, 'session')
}
