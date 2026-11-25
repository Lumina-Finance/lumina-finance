/**
 * Guards the notice Delete profile leaves for the sign-in screen: it holds the scheduled date until the
 * sign-in screen reads it, and one reading only, since a reload of the sign-in screen must not show it again
 */
import { afterEach, expect, it } from 'vitest'
import { clearProfileDeletedNotice, noteProfileDeleted, readProfileDeletedNotice } from '@/utils/profileDeletedNotice'

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

it('carries no date when the deletion ran at once, and the date when it waits', () => {
  noteProfileDeleted()
  expect(readProfileDeletedNotice()).toEqual({ scheduledFor: null })

  noteProfileDeleted('Jan 19, 2027')
  expect(readProfileDeletedNotice()).toEqual({ scheduledFor: 'Jan 19, 2027' })
})
