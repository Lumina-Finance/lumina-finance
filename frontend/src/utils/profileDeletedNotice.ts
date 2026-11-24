/**
 * Carries "your profile was deleted" from Settings to the sign-in screen
 *
 * Signing out sends the app to the sign-in screen through its own redirect. That redirect carries no
 * state, so the deletion leaves this notice for the sign-in screen to read once. It lives in memory
 * only, so a reload of the sign-in screen no longer shows the message
 *
 * A deletion that waits names its date, already written in the date format the user had, since the
 * sign-in screen has no user to take a format from
 */
export type ProfileDeletedNotice = {
  /** The date a waiting deletion runs, or null when the profile is already gone */
  scheduledFor: string | null
}

let notice: ProfileDeletedNotice | null = null

export function noteProfileDeleted(scheduledFor: string | null = null) {
  notice = { scheduledFor }
}

/** The notice to show, without clearing it, so a render React throws away reads it too */
export function readProfileDeletedNotice() {
  return notice
}

/** Clears the notice once the sign-in screen has shown the message */
export function clearProfileDeletedNotice() {
  notice = null
}

/** What the sign-in screen says about the deletion */
export function getProfileDeletedNoticeText({ scheduledFor }: ProfileDeletedNotice) {
  return scheduledFor
    ? `Your profile will be deleted on ${scheduledFor}. Sign in before then to cancel.`
    : 'Your profile and data were deleted.'
}
