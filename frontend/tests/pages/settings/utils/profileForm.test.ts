/**
 * Guards the reason on the profile pane's Save, which a blank first name, refused by the backend, holds off
 */
import { describe, expect, it } from 'vitest'
import { getProfileSaveBlockedReason } from '@/pages/settings/utils/profileForm'

describe('getProfileSaveBlockedReason', () => {
  it('names the first name when it is blank', () => {
    expect(getProfileSaveBlockedReason(false)).toBe('Enter your first name to save')
  })

  it('gives no reason once the first name is filled in', () => {
    expect(getProfileSaveBlockedReason(true)).toBeUndefined()
  })
})
