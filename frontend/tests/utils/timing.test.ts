import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callWhenPassed, withMinDelay } from '@/utils/timing'

/** A representative minimum duration for callers of the shared timing helper */
const RETRY_MIN_MS = 800

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
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
    const result = withMinDelay(async () => {
      throw failure
    }, RETRY_MIN_MS).catch(rejected)
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

describe('callWhenPassed', () => {
  // When a spent request budget frees its next request, five minutes after the clock below
  const FREES_AT = '2026-10-05T16:05:00Z'

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-10-05T16:00:00Z'))
  })

  it('calls back once the moment passes, and not before', () => {
    const passed = vi.fn()
    callWhenPassed(FREES_AT, passed)
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(passed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(passed).toHaveBeenCalledOnce()
  })

  it('waits on when its timer fires before the moment, as the clock reads it', () => {
    const passed = vi.fn()
    callWhenPassed(FREES_AT, passed)

    // The clock set a second back keeps the timer's own wait, so it fires a second early
    vi.setSystemTime(new Date('2026-10-05T15:59:59Z'))
    vi.advanceTimersByTime(5 * 60_000)
    expect(passed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_000)
    expect(passed).toHaveBeenCalledOnce()
  })

  it.each([
    ['a moment already past', '2026-10-05T15:59:00Z'],
    ['no moment', null],
  ])('calls nothing for %s', (_, at) => {
    const passed = vi.fn()
    callWhenPassed(at, passed)
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(passed).not.toHaveBeenCalled()
  })

  it('calls nothing once cancelled', () => {
    const passed = vi.fn()
    const cancel = callWhenPassed(FREES_AT, passed)
    cancel()
    vi.advanceTimersByTime(5 * 60_000)
    expect(passed).not.toHaveBeenCalled()
  })
})
