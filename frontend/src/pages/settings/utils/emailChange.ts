import { getEmailAddressError } from '@/utils/emailAddress'
import { getEndOtherSessionsBlockedReason } from '@/pages/settings/utils/endOtherSessions'

/**
 * Whether the Email field holds an address other than the saved one
 *
 * A draft that reads the same as the saved address, or that only adds spaces around it, is not a
 * change. The draft is null until the field is edited
 */
export function isEmailDraftDirty(draft: string | null, savedEmail: string): boolean {
  return draft !== null && draft.trim() !== savedEmail
}

/**
 * The message shown once a confirmation email is on its way. The address stays as it was until the user
 * uses the link
 */
export function getEmailChangeSentMessage(address: string): string {
  return `We've sent a confirmation email to ${address}. Please confirm your email using the link included in the email.`
}

/**
 * Says why Save is held off on the Security card, or nothing once it can run
 *
 * An email change and a password change each ask the user to confirm it's them, so they go one at a
 * time. A changed email also needs an address with the shape of one and a way to confirm: a password or
 * a linked sign-in provider
 */
export function getSecuritySaveBlockedReason({
  emailDirty,
  passwordDirty,
  emailDraft,
  hasPassword,
  linkedProviderCount,
  passwordReason,
}: {
  emailDirty: boolean
  passwordDirty: boolean
  emailDraft: string
  hasPassword: boolean
  linkedProviderCount: number
  passwordReason: string | undefined
}): string | undefined {
  if (emailDirty && passwordDirty) return 'Save the email and the password changes one at a time'
  if (emailDirty) {
    if (getEmailAddressError(emailDraft.trim())) return 'Enter a valid email address to save'
    return getEndOtherSessionsBlockedReason(hasPassword, linkedProviderCount)
  }
  return passwordDirty ? passwordReason : undefined
}
