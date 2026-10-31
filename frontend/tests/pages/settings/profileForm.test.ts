/**
 * Tests what the profile form sends on save, and the date format choices it offers with an example of
 * each written in that format
 */
import { describe, expect, it } from 'vitest'
import { buildActionKeyOptions, buildDateFormatOptions } from '@/pages/settings/formatOptions'
import {
  getProfilePatch,
  isProfileFormDirty,
  profileFormFromUser,
  type ProfileFormState,
  type SavedProfile,
} from '@/pages/settings/profileForm'
import { DEFAULT_DATE_FORMAT, readDateFormat, setDateFormat } from '@/utils/dateFormat'

const SAVED_PROFILE: SavedProfile = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  tz: 'America/Toronto',
  date_format: 'month-day-year',
  action_key: 'alt',
}

describe('saving the profile', () => {
  it.each<{ name: string; change: Partial<ProfileFormState>; patch: object }>([
    { name: 'a new date format', change: { date_format: 'iso' }, patch: { date_format: 'iso' } },
    { name: 'a new action key', change: { action_key: 'left-alt' }, patch: { action_key: 'left-alt' } },
    { name: 'a new timezone', change: { tz: 'Asia/Tokyo' }, patch: { tz: 'Asia/Tokyo' } },
    { name: 'nothing changed', change: {}, patch: {} },
  ])('sends only what changed, for $name', ({ change, patch }) => {
    const form = { ...profileFormFromUser(SAVED_PROFILE), ...change }

    expect(getProfilePatch(form, SAVED_PROFILE)).toEqual(patch)
    expect(isProfileFormDirty(form, SAVED_PROFILE)).toBe(Object.keys(patch).length > 0)
  })
})

describe('action key choices', () => {
  it('offers either Alt key or the left one alone, and no Control, Command or Shift key', () => {
    expect(buildActionKeyOptions(false).map((option) => option.value)).toEqual(['alt', 'left-alt'])
  })

  it('names the key Option on a Mac and Alt elsewhere', () => {
    expect(buildActionKeyOptions(true).map((option) => option.label)).toEqual(['Option', 'Left Option'])
    expect(buildActionKeyOptions(false).map((option) => option.label)).toEqual(['Alt', 'Left Alt'])
  })
})

describe('date format choices', () => {
  it('offers every date format, each shown by a sample date written in that format', () => {
    expect(buildDateFormatOptions()).toEqual([
      { value: 'month-day-year', label: 'Sep 24, 2026', description: 'Month, day, year' },
      { value: 'day-month-year', label: '24 Sep 2026', description: 'Day, month, year' },
      { value: 'iso', label: '2026-09-24', description: 'Year, month, day (ISO 8601)' },
    ])
  })

  it('shows the examples without changing the format the app is using', () => {
    setDateFormat('iso')
    buildDateFormatOptions()

    expect(readDateFormat()).toBe('iso')
    setDateFormat(DEFAULT_DATE_FORMAT)
  })
})
