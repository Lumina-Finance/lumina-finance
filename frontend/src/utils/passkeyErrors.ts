import { WebAuthnError } from '@simplewebauthn/browser';

/**
 * Whether the user dismissed or let the passkey prompt time out
 *
 * A cancelled ceremony is a deliberate action, not a failure, so callers stay silent rather than
 * showing an error
 */
export function isPasskeyCeremonyCancelled(error: unknown): boolean {
  return error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED';
}

/**
 * Turns a failed passwordless sign-in into a message the user can act on
 *
 * A WebAuthnError comes from the browser prompt itself, while any other error is the server rejecting
 * the assertion and already carries a usable message
 */
export function getPasskeySignInMessage(error: unknown): string {
  if (error instanceof WebAuthnError) {
    return 'Could not sign in with a passkey. Try again, or use your email and password.';
  }
  return error instanceof Error && error.message ? error.message : 'Passkey sign-in failed.';
}
