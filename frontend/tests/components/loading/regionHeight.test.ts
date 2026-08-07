/**
 * Tests the height a loading region holds through a load, so a rewrite catches a spinner sitting in
 * a box too small to hold it, a list that snaps to its height instead of growing into it, and a
 * region that never gives the height back once the rows are on screen
 */
import { describe, expect, it } from 'vitest'
import { getLoadingRegionHeight } from '@/components/loading/regionHeight'

const base = {
  loadingVisible: false,
  contentHeight: null,
  revealSettled: true,
  shouldReduceMotion: false,
}

describe('loading region height', () => {
  it('starts a load at the height the section already had', () => {
    expect(getLoadingRegionHeight({ ...base, loadingVisible: true, revealSettled: false, contentHeight: 44 }))
      .toBe(44)
  })

  it('follows the rows up as they arrive behind the spinner', () => {
    expect(getLoadingRegionHeight({ ...base, loadingVisible: true, revealSettled: false, contentHeight: 560 }))
      .toBe(560)
  })

  it('keeps hold of the height as the spinner leaves, so a shorter list shrinks rather than snapping', () => {
    expect(getLoadingRegionHeight({ ...base, revealSettled: false, contentHeight: 42 })).toBe(42)
  })

  it('gives the height back once the reveal has settled', () => {
    expect(getLoadingRegionHeight({ ...base, contentHeight: 560 })).toBeNull()
  })

  it('holds no height before the content has been measured', () => {
    expect(getLoadingRegionHeight({ ...base, loadingVisible: true, revealSettled: false })).toBeNull()
  })

  it('holds nothing where the content has no height, rather than clipping its own spinner', () => {
    // A measured zero is not the same as nothing measured yet, so the check that separates them
    // has to be for null rather than for a falsy value
    expect(getLoadingRegionHeight({ ...base, loadingVisible: true, revealSettled: false, contentHeight: 0 }))
      .toBeNull()
  })

  it('holds no height at all under reduced motion, since there is nothing to animate', () => {
    expect(getLoadingRegionHeight({
      ...base,
      loadingVisible: true,
      revealSettled: false,
      contentHeight: 44,
      shouldReduceMotion: true,
    })).toBeNull()
    // The reveal is the other half of it, where a guard placed inside the spinner's own branch
    // would leave the shrink animating
    expect(getLoadingRegionHeight({
      ...base,
      revealSettled: false,
      contentHeight: 42,
      shouldReduceMotion: true,
    })).toBeNull()
  })
})
