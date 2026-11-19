import type { ResetLinkStatus } from '@/api/auth'

/**
 * Warns that a reset removes the account's linked sign-in providers, worded for one or several.
 * Gives nothing when none are linked or the link check has no answer, since a dead link is
 * refused on submit with its own message
 */
export function describeProviderRemoval(status: ResetLinkStatus | undefined): string | undefined {
  const linked = status?.sign_in_providers_linked ?? 0
  if (linked === 1)
    return 'Resetting your password also removes your linked sign-in provider. You can link it again in Settings.'
  if (linked > 1)
    return 'Resetting your password also removes your linked sign-in providers. You can link them again in Settings.'
  return undefined
}
