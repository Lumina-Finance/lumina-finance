/**
 * What a payee value is matched under, which is the value trimmed with its capitals folded
 *
 * The same rule the commit applies, so the page and the server agree on which values are one payee.
 * A file carrying both "Amazon" and "AMAZON" asks about them once and files both under one merchant
 */
export function getMerchantNameKey(name: string) {
  return name.trim().toLowerCase()
}
