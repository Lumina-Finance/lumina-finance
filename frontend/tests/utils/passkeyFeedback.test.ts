import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withPasskeyFeedbackMinimum } from '@/utils/passkeyFeedback'

vi.mock('@/utils/passkeyErrors', () => ({
  isPasskeyCeremonyCancelled: (error: unknown) => error instanceof Error && error.message === 'cancelled',
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('passkey loading feedback', () => {
  it.each([
    ['success', () => Promise.resolve('verified')],
    ['failure', () => Promise.reject(new Error('rejected'))],
  ] as const)('holds a fast %s for 800 ms', async (_label, action) => {
    const settled = vi.fn()
    const result = withPasskeyFeedbackMinimum(action).then(settled, settled)

    await vi.advanceTimersByTimeAsync(799)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(settled).toHaveBeenCalledOnce()
  })

  it('returns native prompt cancellation without adding a delay', async () => {
    const cancellation = new Error('cancelled')
    const result = withPasskeyFeedbackMinimum(() => Promise.reject(cancellation))

    await expect(result).rejects.toBe(cancellation)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not add a second wait after a slow action', async () => {
    const settled = vi.fn()
    const result = withPasskeyFeedbackMinimum(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('verified'), 1200)),
    ).then(settled)

    await vi.advanceTimersByTimeAsync(1199)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await result
    expect(settled).toHaveBeenCalledWith('verified')
  })
})
