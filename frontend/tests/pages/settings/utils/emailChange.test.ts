/**
 * Guards when the Security card counts the Email field as changed, and why its Save is held off.
 * Typing the saved address back is no change, and an email change and a password change never run
 * together, since each asks the user to confirm it's them
 */
import { describe, expect, it } from 'vitest'
import {
  getEmailChangeSentMessage,
  getSecuritySaveBlockedReason,
  isEmailDraftDirty,
} from '@/pages/settings/utils/emailChange'

const ready = {
  emailDirty: true,
  passwordDirty: false,
  emailDraft: 'new@example.com',
  hasPassword: true,
  linkedProviderCount: 0,
  passwordReason: undefined,
}

describe('isEmailDraftDirty', () => {
  it('is clean until the field is edited', () => {
    expect(isEmailDraftDirty(null, 'me@example.com')).toBe(false)
  })

  it('is clean when the text matches the saved address, spaces around it aside', () => {
    expect(isEmailDraftDirty('me@example.com', 'me@example.com')).toBe(false)
    expect(isEmailDraftDirty(' me@example.com ', 'me@example.com')).toBe(false)
  })

  it('counts a capitals-only edit and an emptied field as changes', () => {
    expect(isEmailDraftDirty('Me@example.com', 'me@example.com')).toBe(true)
    expect(isEmailDraftDirty('', 'me@example.com')).toBe(true)
  })
})

describe('getSecuritySaveBlockedReason', () => {
  it('lets a changed, well-formed address go ahead for an account with a password', () => {
    expect(getSecuritySaveBlockedReason(ready)).toBeUndefined()
  })

  it('lets a passwordless account with a linked provider go ahead', () => {
    expect(getSecuritySaveBlockedReason({ ...ready, hasPassword: false, linkedProviderCount: 1 })).toBeUndefined()
  })

  it('holds a changed email and a changed password off, one at a time', () => {
    expect(getSecuritySaveBlockedReason({ ...ready, passwordDirty: true })).toBe(
      'Save the email and the password changes one at a time',
    )
  })

  it('holds a badly formed or empty address off', () => {
    expect(getSecuritySaveBlockedReason({ ...ready, emailDraft: 'not-an-address' })).toBe(
      'Enter a valid email address to save',
    )
    expect(getSecuritySaveBlockedReason({ ...ready, emailDraft: '' })).toBe('Enter a valid email address to save')
  })

  it('holds an account with no way to confirm off, with the sign-out reason', () => {
    expect(getSecuritySaveBlockedReason({ ...ready, hasPassword: false, linkedProviderCount: 0 })).toBe(
      "Confirming it's you needs a password or a linked sign-in provider",
    )
  })

  it('gives the password form its own reason when only the password changed', () => {
    expect(
      getSecuritySaveBlockedReason({ ...ready, emailDirty: false, passwordDirty: true, passwordReason: 'Fix it' }),
    ).toBe('Fix it')
  })

  it('has no reason when nothing changed', () => {
    expect(getSecuritySaveBlockedReason({ ...ready, emailDirty: false })).toBeUndefined()
  })
})

describe('getEmailChangeSentMessage', () => {
  it('names the address the email went to', () => {
    expect(getEmailChangeSentMessage('new@example.com')).toBe(
      "We've sent a confirmation email to new@example.com. Please confirm your email using the link included in the email.",
    )
  })
})
