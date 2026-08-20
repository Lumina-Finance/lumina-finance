/**
 * Covers which staged files count as one the import can go ahead with, since that is what decides
 * whether the file step keeps offering an upload
 */
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import { hasAcceptedFile } from '@/pages/imports/utils'

/**
 * Builds a staged draft, taking the error and notice the reader would have recorded on it
 */
function createFile({ error = null, notice }: { error?: string | null; notice?: string }): ImportFileDraft {
  return {
    id: 'file_1',
    name: 'Statement.csv',
    size: 2048,
    headers: ['Date', 'Amount'],
    hasHeaderRow: true,
    rows: error ? [] : [{ Date: '2026-06-01', Amount: '-12.40' }],
    error,
    notice,
  }
}

describe('whether a usable file is staged', () => {
  it('says no with nothing staged', () => {
    expect(hasAcceptedFile([])).toBe(false)
  })

  it('says yes for a file that read cleanly', () => {
    expect(hasAcceptedFile([createFile({})])).toBe(true)
  })

  // The reader records its refusal on the draft rather than throwing, so a refused file is staged
  // like any other. Reading it as accepted would take away the upload control for exactly the file
  // that has to be replaced
  it('says no for a file the reader refused', () => {
    const refused = createFile({ error: 'This file has a heading row and no transactions under it.' })

    expect(hasAcceptedFile([refused])).toBe(false)
  })

  // A notice is the opposite case: the file is usable and the import goes ahead, so the upload
  // control has nothing left to offer
  it('says yes for a file staged with a notice and no error', () => {
    const noticed = createFile({ notice: 'Some characters could not be read.' })

    expect(hasAcceptedFile([noticed])).toBe(true)
  })
})
