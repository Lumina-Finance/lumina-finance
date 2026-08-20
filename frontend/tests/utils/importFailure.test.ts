/**
 * Tests what an import shows the user when it fails, both where the failure says something and
 * where it says nothing at all
 *
 * The request layer and the import pages both read a failure this way, so a rejection carrying no
 * message has to produce the same words wherever it is caught
 */
import { describe, expect, it } from 'vitest'
import { getImportFailureMessage } from '@/utils/importFailure'

describe('reading a message off a failed import', () => {
  // An empty message used to reach the user as a blank failure notice, since nothing caught it
  it('falls back for an Error carrying no message', () => {
    expect(getImportFailureMessage(new Error(''))).toBe('Import failed.')
  })

  it('falls back for a rejection that is not an Error', () => {
    expect(getImportFailureMessage('boom')).toBe('Import failed.')
    expect(getImportFailureMessage({ message: 'boom' })).toBe('Import failed.')
  })

  it('keeps the message an Error carries', () => {
    expect(getImportFailureMessage(new Error('Row 3 is broken'))).toBe('Row 3 is broken')
  })
})
