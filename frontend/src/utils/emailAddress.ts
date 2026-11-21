const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Says what is wrong with an email address typed into a form, or nothing when it has the shape of one
 *
 * Only the shape is checked, since the server decides whether an address is acceptable
 */
export function getEmailAddressError(email: string): string | undefined {
  if (!email) return 'Email is required'
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address'
  return undefined
}
