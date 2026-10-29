/**
 * Tests when the "Last import" card's flash starts for an import another tab saved
 *
 * These tests catch a flash that starts while the tab is in the background, which would be spent
 * before anyone looks, one that starts before the pause is over, and one that starts twice
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startWhenVisible, type VisibilitySource } from '@/pages/imports/utils/flashWhenVisible'

function fakePage(initial: DocumentVisibilityState) {
  const listeners = new Set<() => void>()
  const page = {
    visibilityState: initial,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  function show(state: DocumentVisibilityState) {
    page.visibilityState = state
    listeners.forEach((listener) => listener())
  }
  return { source: page as unknown as VisibilitySource, show, listenerCount: () => listeners.size }
}

describe('startWhenVisible', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts once, after the pause, for a tab in view', () => {
    const page = fakePage('visible')
    const start = vi.fn()
    startWhenVisible(page.source, 640, start)

    vi.advanceTimersByTime(639)
    expect(start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(start).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(start).toHaveBeenCalledTimes(1)
    expect(page.listenerCount()).toBe(0)
  })

  it('waits for a tab in the background until it comes into view, then pauses', () => {
    const page = fakePage('hidden')
    const start = vi.fn()
    startWhenVisible(page.source, 640, start)

    vi.advanceTimersByTime(60_000)
    expect(start).not.toHaveBeenCalled()

    page.show('visible')
    vi.advanceTimersByTime(639)
    expect(start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('starts the pause over when the tab leaves view and returns', () => {
    const page = fakePage('visible')
    const start = vi.fn()
    startWhenVisible(page.source, 640, start)

    vi.advanceTimersByTime(500)
    page.show('hidden')
    vi.advanceTimersByTime(10_000)
    expect(start).not.toHaveBeenCalled()

    page.show('visible')
    vi.advanceTimersByTime(639)
    expect(start).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('never starts once stopped', () => {
    const page = fakePage('visible')
    const start = vi.fn()
    const stop = startWhenVisible(page.source, 640, start)

    stop()
    vi.advanceTimersByTime(5000)
    page.show('visible')
    vi.advanceTimersByTime(5000)
    expect(start).not.toHaveBeenCalled()
    expect(page.listenerCount()).toBe(0)
  })
})
