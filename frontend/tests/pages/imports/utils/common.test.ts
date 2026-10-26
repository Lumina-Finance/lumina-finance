/**
 * Covers the small helpers every import shares: removing a value from a set or a record, rendering
 * a file size, and which new sources an import counts as created
 */
import { describe, expect, it } from 'vitest'
import { countCreatedImportSources, formatBytes, removeRecordKey, removeSetValue } from '@/pages/imports/utils'

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

  // Rounding to the nearest turned a refusal into "25.0 MB, and the importer reads files up to 25.0 MB"
  it('rounds up, so a size over a limit never reads as the limit', () => {
    expect(formatBytes(26214401)).toBe('25.1 MB')
    expect(formatBytes(1025)).toBe('1.1 KB')
  })
})

describe('counting the sources an import creates', () => {
  it('leaves out a source answered create whose rows are all left out of the upload', () => {
    const mappings = { Checking: 'create', Savings: 'create', Wallet: 'account-1' }

    expect(countCreatedImportSources(['Checking', 'Savings', 'Wallet'], mappings, 'create', new Set(['Checking', 'Wallet']))).toBe(1)
  })
})
