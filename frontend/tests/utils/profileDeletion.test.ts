/**
 * Guards the dates Delete profile names when a wait applies, in the user's zone and the date format
 * they chose, so the dialogue, the sign-in notice and the waiting screen never name a different day
 * than the one the user's calendar is on, and that only a cancel refused as too late signs the user out
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DATE_FORMAT, setDateFormat } from '@/utils/dateFormat'
import { ApiError } from '@/api/auth'
import { formatDeletionDateAfterWait, formatDeletionDueDate, isCancelTooLate } from '@/utils/profileDeletion'

afterEach(() => setDateFormat(DEFAULT_DATE_FORMAT))

const DAY = 24 * 60 * 60

describe('formatDeletionDateAfterWait', () => {
  // 03:00 UTC is still the evening before in Toronto and already the afternoon in Auckland
  const now = new Date('2026-12-20T03:00:00Z')

  it('adds the wait to the current time and names the day it ends on in the user zone, across a year end', () => {
    expect(formatDeletionDateAfterWait(30 * DAY, 'UTC', now)).toBe('Jan 19, 2027')
    expect(formatDeletionDateAfterWait(30 * DAY, 'America/Toronto', now)).toBe('Jan 18, 2027')
    expect(formatDeletionDateAfterWait(30 * DAY, 'Pacific/Auckland', now)).toBe('Jan 19, 2027')
  })

  it('never rounds a wait up to a whole day', () => {
    expect(formatDeletionDateAfterWait(60 * 60, 'UTC', now)).toBe('Dec 20, 2026')
    expect(formatDeletionDateAfterWait(22 * 60 * 60, 'UTC', now)).toBe('Dec 21, 2026')
    expect(formatDeletionDateAfterWait(22 * 60 * 60, 'America/Toronto', now)).toBe('Dec 20, 2026')
    expect(formatDeletionDateAfterWait(7 * DAY, 'UTC', now)).toBe('Dec 27, 2026')
  })

  it('writes the date in the format the app is set to', () => {
    setDateFormat('iso')
    expect(formatDeletionDateAfterWait(30 * DAY, 'UTC', now)).toBe('2027-01-19')
    setDateFormat('day-month-year')
    expect(formatDeletionDateAfterWait(30 * DAY, 'UTC', now)).toBe('19 Jan 2027')
  })
})

describe('formatDeletionDueDate', () => {
  const dueAt = '2027-01-19T23:30:00Z'

  it('names the day the due time falls on in the user zone', () => {
    expect(formatDeletionDueDate(dueAt, 'UTC')).toBe('Jan 19, 2027')
    expect(formatDeletionDueDate(dueAt, 'Pacific/Auckland')).toBe('Jan 20, 2027')
    expect(formatDeletionDueDate(dueAt, 'America/Toronto')).toBe('Jan 19, 2027')
  })

  it('writes the date in the format the app is set to', () => {
    setDateFormat('iso')
    expect(formatDeletionDueDate(dueAt, 'UTC')).toBe('2027-01-19')
  })
})

describe('isCancelTooLate', () => {
  it('signs the user out for the 409 the server answers once the due time has passed', () => {
    const detail = 'Your profile is already being deleted, so the deletion can no longer be cancelled'
    expect(isCancelTooLate(new ApiError(detail, 409))).toBe(true)
  })

  it('leaves the user on the screen for any other failure', () => {
    expect(isCancelTooLate(new ApiError('Something went wrong', 500))).toBe(false)
    expect(isCancelTooLate(new TypeError('Failed to fetch'))).toBe(false)
  })
})
