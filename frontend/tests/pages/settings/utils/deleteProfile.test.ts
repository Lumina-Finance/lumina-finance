/**
 * Guards the word that lets Delete profile go on to the identity check, so a near miss never deletes
 * a profile and a capital or a stray space never holds one back
 */
import { expect, it } from 'vitest'
import { isDeletionConfirmed } from '@/pages/settings/utils/deleteProfile'

it('goes on only once the user types delete, whatever the capitals and surrounding spaces', () => {
  expect(isDeletionConfirmed('delete')).toBe(true)
  expect(isDeletionConfirmed('  Delete ')).toBe(true)
  expect(isDeletionConfirmed('DELETE')).toBe(true)

  expect(isDeletionConfirmed('')).toBe(false)
  expect(isDeletionConfirmed('delet')).toBe(false)
  expect(isDeletionConfirmed('delete profile')).toBe(false)
  expect(isDeletionConfirmed('"delete"')).toBe(false)
})
