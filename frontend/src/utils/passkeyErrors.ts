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
 * A WebAuthnError comes from the browser prompt itself, so it keeps the email-and-password fallback for
 * a device that cannot run the ceremony. A server rejection is a verified-but-refused assertion, which
 * gets the neutral retry message rather than the raw backend detail
 */
export function getPasskeySignInMessage(error: unknown): string {
  if (error instanceof WebAuthnError) {
    return 'Could not sign in with a passkey. Try again, or use your email and password.';
  }
  return "Couldn't verify your passkey. Please try again.";
}

/**
 * Turns a failed passkey registration into a message the user can act on
 *
 * A cancelled prompt, a declined prompt, and an already-registered authenticator are the common cases
 * and read more clearly than the raw library text, while anything else falls back to the server or
 * library message
 */
export function getPasskeyRegistrationMessage(error: unknown): string {
  if (error instanceof WebAuthnError) {
    if (error.code === 'ERROR_CEREMONY_ABORTED') return 'Passkey setup was cancelled or timed out.';
    if (error.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return 'This device already has a passkey for your account.';
    }

    // The library only passes an error through when the browser reports NotAllowedError, which is how
    // a declined permission prompt surfaces, so the raw browser text is replaced with a clear message
    if (error.code === 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') {
      return 'The passkey prompt was declined or timed out, so no passkey was added. Try again to set one up.';
    }
  }
  return error instanceof Error && error.message ? error.message : 'Could not add this passkey.';
}
