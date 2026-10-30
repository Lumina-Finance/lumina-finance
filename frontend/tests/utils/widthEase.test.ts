/**
 * Tests the width keyframes a button eases over when its content changes, so a rewrite catches a width
 * that is not eased from a measured size, and one that animates under reduced motion
 */
import { describe, expect, it } from 'vitest'
import { getWidthEaseKeyframes } from '@/utils/widthEase'

describe('width ease keyframes', () => {
  it('runs from the measured width to the new one in pixels, which an auto width can be eased from', () => {
    expect(getWidthEaseKeyframes(118.5, 40, false)).toEqual([{ width: '118.5px' }, { width: '40px' }])
  })

  it('runs outward as well as inward', () => {
    expect(getWidthEaseKeyframes(40, 118.5, false)).toEqual([{ width: '40px' }, { width: '118.5px' }])
  })

  it('animates nothing under reduced motion, so the width changes at once', () => {
    expect(getWidthEaseKeyframes(118.5, 40, true)).toBeNull()
  })

  it('animates nothing when the width did not change', () => {
    expect(getWidthEaseKeyframes(40, 40.2, false)).toBeNull()
  })
})
