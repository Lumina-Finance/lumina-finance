/**
 * Guards the notice Delete profile leaves for the sign-in screen: the plain "deleted" message when the
 * profile is gone, the dated one when it waits to be deleted, and one reading only, since a reload of
 * the sign-in screen must not show it again
 */
import { afterEach, expect, it } from 'vitest'
import {
  clearProfileDeletedNotice,
  getProfileDeletedNoticeText,
  noteProfileDeleted,
  readProfileDeletedNotice,
} from '@/utils/profileDeletedNotice'

afterEach(() => clearProfileDeletedNotice())

it('holds no notice until a deletion leaves one, and none once the sign-in screen clears it', () => {
  expect(readProfileDeletedNotice()).toBeNull()

  noteProfileDeleted()
  expect(readProfileDeletedNotice()).not.toBeNull()
  // Reading leaves it in place, so a render React throws away reads it too
  expect(readProfileDeletedNotice()).not.toBeNull()

  clearProfileDeletedNotice()
  expect(readProfileDeletedNotice()).toBeNull()
})

it('says the profile is gone when the deletion ran at once', () => {
  noteProfileDeleted()
  expect(getProfileDeletedNoticeText(readProfileDeletedNotice()!)).toBe('Your profile and data were deleted.')
})

it('names the date and the way back when the deletion waits', () => {
  noteProfileDeleted('Jan 19, 2027')
  expect(getProfileDeletedNoticeText(readProfileDeletedNotice()!)).toBe(
    'Your profile will be deleted on Jan 19, 2027. Sign in before then to cancel.',
  )
})
