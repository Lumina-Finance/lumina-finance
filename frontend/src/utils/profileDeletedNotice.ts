/**
 * Carries "your profile was deleted" from Settings to the sign-in screen
 *
 * Signing out sends the app to the sign-in screen through its own redirect. That redirect carries no
 * state, so the deletion leaves this flag for the sign-in screen to read once. The flag lives in memory
 * only, so a reload of the sign-in screen no longer shows the message
 */
let profileDeleted = false

export function noteProfileDeleted() {
  profileDeleted = true
}

/** Whether a profile was just deleted, without clearing the flag, so a render React throws away reads it too */
export function wasProfileJustDeleted() {
  return profileDeleted
}

/** Clears the flag once the sign-in screen has shown the message */
export function clearProfileDeletedNotice() {
  profileDeleted = false
}
