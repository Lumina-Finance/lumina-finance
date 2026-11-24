/** The word the user types to confirm Delete profile */
export const DELETE_PROFILE_CONFIRM_WORD = 'delete'

/** Whether the user typed the word that confirms, ignoring capitals and spaces around it */
export function isDeletionConfirmed(typed: string) {
  return typed.trim().toLowerCase() === DELETE_PROFILE_CONFIRM_WORD
}

/**
 * What the red warning in the Delete profile dialogue says: that the deletion is final, or, where a
 * wait applies, the date it runs and that the user can cancel until then
 *
 * @param scheduledFor - The date a waiting deletion runs, or null when it runs at once
 */
export function getDeleteWarning(scheduledFor: string | null) {
  return scheduledFor
    ? `Your profile and data will be deleted on ${scheduledFor}. Until then, you can sign in and cancel.`
    : 'This will permanently delete all your data and is irrevocable.'
}
