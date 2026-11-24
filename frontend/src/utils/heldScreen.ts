import type { User } from '@/api/auth/types'

/** The screen that takes the place of the whole app until the user acts on it */
export type HeldScreen = 'scheduled-deletion' | 'reenrollment'

/**
 * Names the screen that holds a signed-in user back from the app, or null when nothing does
 *
 * A profile waiting to be deleted comes first. The server refuses a marked profile on every route, the
 * re-enrolment ones included, so a user held for both can only cancel the deletion. Re-enrolment follows
 * once they have
 *
 * @param user - The signed-in user, or null before there is one
 */
export function getHeldScreen(
  user: Pick<User, 'deletion_due_at' | 'second_factor_reenrollment_required'> | null,
): HeldScreen | null {
  if (user?.deletion_due_at) return 'scheduled-deletion'
  if (user?.second_factor_reenrollment_required) return 'reenrollment'
  return null
}
