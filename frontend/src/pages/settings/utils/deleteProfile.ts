/** The word the user types to confirm Delete profile */
export const DELETE_PROFILE_CONFIRM_WORD = 'delete'

/** Whether the user typed the word that confirms, ignoring capitals and spaces around it */
export function isDeletionConfirmed(typed: string) {
  return typed.trim().toLowerCase() === DELETE_PROFILE_CONFIRM_WORD
}
