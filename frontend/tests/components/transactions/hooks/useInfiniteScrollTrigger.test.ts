/**
 * Covers when a list at its end fetches the next page. A list fetches once the end has stayed near for
 * a second, and one whose rows grow in asks again at that point, so word of where the end has gone that
 * arrives late is not acted on
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchSentinel } from '@/components/transactions/hooks/useInfiniteScrollTrigger'

type FakeObserver = { report: (isIntersecting: boolean) => void; isWatching: boolean }

describe('watching the end of a list', () => {
  let observers: FakeObserver[]

  beforeEach(() => {
    vi.useFakeTimers()
    observers = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        isWatching = true
        callback: (entries: { isIntersecting: boolean }[]) => void
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          this.callback = callback
          observers.push(this as unknown as FakeObserver)
        }
        observe() {}
        disconnect() {
          this.isWatching = false
        }
        report(isIntersecting: boolean) {
          this.callback([{ isIntersecting }])
        }
      },
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function watch(rechecksSentinel: boolean) {
    const fetchNextPage = vi.fn()
    watchSentinel({
      element: {} as HTMLElement,
      fetchNextPage,
      setPendingFetch: () => {},
      rechecksSentinel,
    })
    return fetchNextPage
  }

  it('fetches the next page when the end has stayed near for a second', () => {
    const fetchNextPage = watch(false)

    observers[0].report(true)
    vi.advanceTimersByTime(999)
    expect(fetchNextPage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
    expect(observers).toHaveLength(1)
  })

  it('asks again when the second runs out, and fetches only if the end is still near', () => {
    const fetchNextPage = watch(true)

    observers[0].report(true)
    vi.advanceTimersByTime(1000)
    expect(fetchNextPage).not.toHaveBeenCalled()
    expect(observers).toHaveLength(2)

    observers[1].report(false)

    expect(fetchNextPage).not.toHaveBeenCalled()
    expect(observers[1].isWatching).toBe(false)
  })

  it('fetches once the second look finds the end still near', () => {
    const fetchNextPage = watch(true)

    observers[0].report(true)
    vi.advanceTimersByTime(1000)
    observers[1].report(true)

    expect(fetchNextPage).toHaveBeenCalledTimes(1)
  })
})
