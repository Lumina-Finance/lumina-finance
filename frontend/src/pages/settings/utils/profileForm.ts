/**
 * Says why a changed profile can't be saved yet, or nothing once it can
 */
export function getProfileSaveBlockedReason(firstNameValid: boolean): string | undefined {
  return firstNameValid ? undefined : 'Enter your first name to save'
}
