import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withMinDelay } from '@/utils/timing'

/** A representative minimum duration for callers of the shared timing helper */
const RETRY_MIN_MS = 800

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('withMinDelay', () => {
  it('holds an immediate successful request for 800 ms', async () => {
    const settled = vi.fn()
    const result = withMinDelay(async () => 'currencies', RETRY_MIN_MS).then(settled)
    await vi.advanceTimersByTimeAsync(799)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(settled).toHaveBeenCalledWith('currencies')
  })

  it('holds an immediate request failure for 800 ms', async () => {
    const failure = new Error('Currency request failed')
    const rejected = vi.fn()
    const result = withMinDelay(async () => { throw failure }, RETRY_MIN_MS).catch(rejected)
    await vi.advanceTimersByTimeAsync(799)
    expect(rejected).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(rejected).toHaveBeenCalledWith(failure)
  })

  it('waits for a slow request without adding another 800 ms afterward', async () => {
    const settled = vi.fn()
    const result = withMinDelay(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('currencies'), 1200)),
      RETRY_MIN_MS,
    ).then(settled)
    await vi.advanceTimersByTimeAsync(800)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    await result
    expect(settled).toHaveBeenCalledWith('currencies')
  })
})
