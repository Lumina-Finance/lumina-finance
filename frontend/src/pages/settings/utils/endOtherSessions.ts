/**
 * Says why signing out of other devices is unavailable, or undefined when it can start
 *
 * Confirming it takes a password or a linked sign-in provider, so an account with neither, such as one
 * that signs in only with a passkey, has no way to confirm. That account can't set a password or link a
 * provider either, so the reason names what is missing rather than a step
 */
export function getEndOtherSessionsBlockedReason(
  hasPassword: boolean,
  linkedProviderCount: number,
): string | undefined {
  if (hasPassword || linkedProviderCount > 0) return undefined
  return "Confirming it's you needs a password or a linked sign-in provider"
}
