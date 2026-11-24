/**
 * Guards which screen holds a signed-in user back: a profile waiting to be deleted comes before
 * re-enrolment, since the server refuses a marked profile on every re-enrolment route, so a user held for
 * both could otherwise never cancel
 */
import { expect, it } from 'vitest'
import { getHeldScreen } from '@/utils/heldScreen'

it('holds a waiting profile on the cancel screen even when re-enrolment is also required', () => {
  expect(getHeldScreen({ deletion_due_at: '2027-01-19T00:00:00Z', second_factor_reenrollment_required: true })).toBe(
    'scheduled-deletion',
  )
  expect(getHeldScreen({ deletion_due_at: '2027-01-19T00:00:00Z', second_factor_reenrollment_required: false })).toBe(
    'scheduled-deletion',
  )
})

it('follows with re-enrolment once the deletion is cancelled', () => {
  expect(getHeldScreen({ deletion_due_at: null, second_factor_reenrollment_required: true })).toBe('reenrollment')
})

it('holds nobody back when neither applies, or before there is a user', () => {
  expect(getHeldScreen({ deletion_due_at: null, second_factor_reenrollment_required: false })).toBeNull()
  expect(getHeldScreen(null)).toBeNull()
})
