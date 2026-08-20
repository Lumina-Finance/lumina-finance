/**
 * Covers which staged files count as one the import can go ahead with, since that is what decides
 * whether the file step keeps offering an upload
 */
import { describe, expect, it } from 'vitest'
import type { ImportFileDraft } from '@/pages/imports/types'
import { formatBytes, hasAcceptedFile, removeRecordKey, removeSetValue } from '@/pages/imports/utils'

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

describe('removing a value from a set that may not hold it', () => {
  it('returns the same set when the value was never in it', () => {
    const set = new Set(['a'])

    expect(removeSetValue(set, 'b')).toBe(set)
  })

  it('returns a new set without the value, leaving the original untouched', () => {
    const set = new Set(['a', 'b'])

    expect(removeSetValue(set, 'a')).toEqual(new Set(['b']))
    expect(set.has('a')).toBe(true)
  })
})

describe('removing a key from a record that may not hold it', () => {
  it('returns the same record when the key was never present', () => {
    const record = { a: 'x' }

    expect(removeRecordKey(record, 'b')).toBe(record)
  })

  it('returns a new record without the key, leaving the original untouched', () => {
    const record = { a: 'x', b: 'y' }

    expect(removeRecordKey(record, 'b')).toEqual({ a: 'x' })
    expect(record.b).toBe('y')
  })
})

describe('rendering a file size', () => {
  it('stays in kilobytes one byte short of a megabyte', () => {
    expect(formatBytes(1048575)).toBe('1024.0 KB')
  })

  it('switches from bytes to kilobytes exactly at 1024', () => {
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
  })

  it('renders the size the refusal message quotes', () => {
    expect(formatBytes(26214400)).toBe('25.0 MB')
  })
})
