/**
 * Guards the reason on the password pane's Save. A changed pane with every field filled in but a new
 * password that breaks the rules, or two that differ, used to be told to complete fields it had completed
 */
import { describe, expect, it } from 'vitest'
import { getPasswordSaveBlockedReason } from '@/pages/settings/utils/passwordForm'

const READY = { currentPasswordFilled: true, newPasswordValid: true, confirmMatches: true }

describe('getPasswordSaveBlockedReason', () => {
  it('names the current password when it is empty, ahead of the other parts', () => {
    expect(getPasswordSaveBlockedReason({ currentPasswordFilled: false, newPasswordValid: false, confirmMatches: false }))
      .toBe('Enter your current password to save')
  })

  it('names the requirements when the new password breaks them, ahead of a mismatch', () => {
    expect(getPasswordSaveBlockedReason({ ...READY, newPasswordValid: false, confirmMatches: false }))
      .toBe('Choose a new password that meets the requirements')
  })

  it('names the mismatch when only the confirmation differs', () => {
    expect(getPasswordSaveBlockedReason({ ...READY, confirmMatches: false })).toBe('Make the new passwords match')
  })

  it('gives no reason when every part is right', () => {
    expect(getPasswordSaveBlockedReason(READY)).toBeUndefined()
  })
})
