/**
 * Tests the width keyframes a button eases over when its content changes, so a rewrite catches a width
 * that is not eased from a measured size, and one that animates under reduced motion. Also the points of
 * the ease where the fading words have the room they need, so a word is never cut by the button's ends,
 * and where the old word is gone and the new one begins, so the two are never on screen together
 */
import { describe, expect, it } from 'vitest'
import { getFadeFitShares, getWidthEaseKeyframes, getWordSwapShares, WORD_SWAP_SPLIT } from '@/utils/widthEase'

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

describe('fade fit shares', () => {
  // Export all (128px) giving way to Export filtered (173px), whose word ends 157px from the button's left edge
  it('keeps the incoming content invisible until the widening width holds it, and the outgoing visible throughout', () => {
    const { incomingStart, outgoingEnd } = getFadeFitShares(128, 173, 157, 112)
    // The width has to reach 157 + 4 = 161 of the way from 128 to 173, which is 33 of 45
    expect(incomingStart).toBeCloseTo(33 / 45, 6)
    expect(outgoingEnd).toBe(1)
  })

  it('removes the outgoing content before the narrowing width shrinks past it, and shows the incoming at once', () => {
    const { incomingStart, outgoingEnd } = getFadeFitShares(173, 128, 112, 157)
    // The width may fall to 161 before the outgoing content is cut: 12 of the 45 it has to fall
    expect(outgoingEnd).toBeCloseTo(12 / 45, 6)
    expect(incomingStart).toBe(0)
  })

  it('never lets a fade start past the end of the ease or before its start', () => {
    expect(getFadeFitShares(100, 110, 300, 0).incomingStart).toBe(1)
    expect(getFadeFitShares(110, 100, 0, 300).outgoingEnd).toBe(0)
    expect(getFadeFitShares(100, 100, 50, 50)).toEqual({ incomingStart: 0, outgoingEnd: 1 })
  })

  it('leaves a margin beyond the end of the word, so it does not touch the button', () => {
    expect(getFadeFitShares(100, 200, 120, 0, 10).incomingStart).toBeCloseTo(0.3, 6)
    expect(getFadeFitShares(100, 200, 100, 0, 0).incomingStart).toBe(0)
  })
})

describe('word swap shares', () => {
  it('has the old word gone before the new one begins when the button widens', () => {
    const { incomingStart, outgoingEnd } = getWordSwapShares(128, 173, 157, 112)
    expect(outgoingEnd).toBeLessThanOrEqual(incomingStart)
    expect(outgoingEnd).toBe(WORD_SWAP_SPLIT)
    expect(incomingStart).toBeCloseTo(33 / 45, 6)
  })

  it('has the old word gone before the new one begins when the button narrows', () => {
    const { incomingStart, outgoingEnd } = getWordSwapShares(173, 128, 112, 157)
    expect(outgoingEnd).toBeLessThanOrEqual(incomingStart)
    // The old word has to go before the width shrinks past it, which comes sooner than the split
    expect(outgoingEnd).toBeCloseTo(12 / 45, 6)
    expect(incomingStart).toBe(WORD_SWAP_SPLIT)
  })

  it('still separates the two words when the width does not change', () => {
    expect(getWordSwapShares(150, 150, 140, 140)).toEqual({
      incomingStart: WORD_SWAP_SPLIT,
      outgoingEnd: WORD_SWAP_SPLIT,
    })
  })

  it('separates the two for any pair of widths, whatever room each word needs', () => {
    for (const [from, to] of [
      [100, 250],
      [250, 100],
      [100, 100.4],
      [180, 120],
    ]) {
      for (const reach of [0, 90, 140, 400]) {
        const { incomingStart, outgoingEnd } = getWordSwapShares(from, to, reach, reach)
        expect(outgoingEnd, `${from} to ${to} with reach ${reach}`).toBeLessThanOrEqual(incomingStart)
      }
    }
  })
})
