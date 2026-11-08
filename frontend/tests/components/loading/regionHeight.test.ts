/**
 * Tests the height a loading region holds through a transition, so a rewrite catches a list that
 * snaps to its new height instead of growing into it, and a region that never gives the height
 * back once the rows are on screen
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLoadingRegionHeight, observeContentHeight } from '@/components/loading/regionHeight'

const base = {
  contentHeight: null,
  revealSettled: true,
  shouldReduceMotion: false,
}

describe('loading region height', () => {
  it('starts a transition at the height the section already had', () => {
    expect(getLoadingRegionHeight({ ...base, revealSettled: false, contentHeight: 44 })).toBe(44)
  })

  it('gives the height back once the reveal has settled', () => {
    expect(getLoadingRegionHeight({ ...base, contentHeight: 560 })).toBeNull()
  })

  it('holds no height before the content has been measured', () => {
    expect(getLoadingRegionHeight({ ...base, revealSettled: false })).toBeNull()
  })

  it('holds nothing where the content has no height, rather than clipping its own spinner', () => {
    // A measured zero is not the same as nothing measured yet, so the check that separates them
    // has to be for null rather than for a falsy value
    expect(getLoadingRegionHeight({ ...base, revealSettled: false, contentHeight: 0 })).toBeNull()
  })

  it('holds no height at all under reduced motion, since there is nothing to animate', () => {
    expect(
      getLoadingRegionHeight({
        ...base,
        revealSettled: false,
        contentHeight: 44,
        shouldReduceMotion: true,
      }),
    ).toBeNull()
  })
})

describe('observing the content height', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A content box 100px tall in layout, drawn 90px tall on screen by a dialogue still scaling in
  function observe(readsLayoutHeight: boolean) {
    const heights: number[] = []
    let report: ((entries: unknown[]) => void) | undefined
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: () => void) => {
        callback()
        return 1
      },
      cancelAnimationFrame: () => {},
    })
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: (entries: unknown[]) => void) {
          report = callback
        }
        observe() {}
        disconnect() {}
      },
    )
    const element = { getBoundingClientRect: () => ({ height: 90 }) } as unknown as HTMLElement
    observeContentHeight(element, (height) => heights.push(height), readsLayoutHeight)
    report?.([{ borderBoxSize: [{ blockSize: 100 }] }])
    return heights
  }

  it('reads the box on screen by default', () => {
    expect(observe(false)).toEqual([90, 90])
  })

  it('reads the layout height when asked, so a scaling dialogue does not shorten it', () => {
    expect(observe(true)).toEqual([100])
  })
})
