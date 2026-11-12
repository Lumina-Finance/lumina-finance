/**
 * Guards a settings section opened from a link easing into place. The observer holding it at the top
 * reports once as it starts, and acting on that report jumped, cutting the smooth scroll short
 */
import { describe, expect, it, vi } from 'vitest'
import { ignoreFirstReport } from '@/pages/settings/utils/ignoreFirstReport'

describe('ignoring the first report of an observer', () => {
  it('does not run the callback for the first report', () => {
    const callback = vi.fn()
    ignoreFirstReport(callback)()

    expect(callback).not.toHaveBeenCalled()
  })

  it('runs the callback for every report after the first', () => {
    const callback = vi.fn()
    const report = ignoreFirstReport(callback)
    report()
    report()
    report()

    expect(callback).toHaveBeenCalledTimes(2)
  })

  it("keeps one wrapper's first report apart from another's", () => {
    const first = vi.fn()
    const second = vi.fn()
    ignoreFirstReport(first)()
    ignoreFirstReport(second)()

    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
  })
})
