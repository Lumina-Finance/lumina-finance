import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRandomId } from '@/utils/randomId'

/**
 * Guards the id helper that replaced crypto.randomUUID so imports work over plain HTTP: every id
 * is 32 hexadecimal characters, including bytes below 16, and ids never repeat
 */
const BATCH_SIZE = 1000

afterEach(() => {
  vi.useRealTimers()
})

describe('random id helper', () => {
  it('makes 32 hexadecimal characters each time, with no repeats in a large batch', () => {
    const ids = Array.from({ length: BATCH_SIZE }, () => createRandomId())

    expect(ids.filter((id) => !/^[0-9a-f]{32}$/.test(id))).toEqual([])
    expect(new Set(ids).size).toBe(BATCH_SIZE)
  })

  it('makes different ids within the same millisecond', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    expect(createRandomId()).not.toBe(createRandomId())
  })
})
