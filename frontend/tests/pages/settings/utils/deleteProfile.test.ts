/**
 * Guards the word that lets Delete profile go on to the identity check, so a near miss never deletes
 * a profile and a capital or a stray space never holds one back, and that the dialogue's warning names
 * the date only where a wait applies
 */
import { expect, it } from 'vitest'
import { getDeleteWarning, isDeletionConfirmed } from '@/pages/settings/utils/deleteProfile'

it('goes on only once the user types delete, whatever the capitals and surrounding spaces', () => {
  expect(isDeletionConfirmed('delete')).toBe(true)
  expect(isDeletionConfirmed('  Delete ')).toBe(true)
  expect(isDeletionConfirmed('DELETE')).toBe(true)

  expect(isDeletionConfirmed('')).toBe(false)
  expect(isDeletionConfirmed('delet')).toBe(false)
  expect(isDeletionConfirmed('delete profile')).toBe(false)
  expect(isDeletionConfirmed('"delete"')).toBe(false)
})

it('warns that the deletion is final, or names the date it runs and that the user can cancel until then', () => {
  expect(getDeleteWarning(null)).toBe('This will permanently delete all your data and is irrevocable.')
  expect(getDeleteWarning('Jan 19, 2027')).toBe(
    'Your profile and data will be deleted on Jan 19, 2027. Until then, you can sign in and cancel.',
  )
})
