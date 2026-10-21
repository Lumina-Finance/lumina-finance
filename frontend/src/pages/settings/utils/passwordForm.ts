/**
 * Says which part of a filled-in password form keeps Save off, in the order the form asks for them, or
 * nothing once every part is right
 */
export function getPasswordSaveBlockedReason({
  currentPasswordFilled,
  newPasswordValid,
  confirmMatches,
}: {
  currentPasswordFilled: boolean
  newPasswordValid: boolean
  confirmMatches: boolean
}): string | undefined {
  if (!currentPasswordFilled) return 'Enter your current password to save'
  if (!newPasswordValid) return 'Choose a new password that meets the requirements'
  if (!confirmMatches) return 'Make the new passwords match'
  return undefined
}
