/**
 * Guards the motion between steps of the two-factor and passkey modals: they fade and ease their height
 * as they always did, and a step asking to follow reduced motion swaps at once instead
 */
import { describe, expect, it } from 'vitest'
import { getStepTransitions } from '@/components/two-factor/stepMotion'

describe('step transitions', () => {
  it('fades the old step out, then the new one in, and eases the height, as a step always did', () => {
    const transitions = getStepTransitions({
      respectsReducedMotion: false,
      prefersReducedMotion: false,
      easesHeight: true,
    })

    expect(transitions.height.duration).toBe(0.26)
    expect(transitions.fadeOut.duration).toBe(0.1)
    expect(transitions.fadeIn).toMatchObject({ duration: 0.2, delay: 0.1 })
  })

  it('swaps at once when the reader asks for less motion and the step respects it', () => {
    const transitions = getStepTransitions({
      respectsReducedMotion: true,
      prefersReducedMotion: true,
      easesHeight: true,
    })

    expect([transitions.height.duration, transitions.fadeOut.duration, transitions.fadeIn.duration]).toEqual([0, 0, 0])
  })

  it('keeps moving under reduced motion unless the step respects it', () => {
    const transitions = getStepTransitions({
      respectsReducedMotion: false,
      prefersReducedMotion: true,
      easesHeight: true,
    })

    expect(transitions.height.duration).toBe(0.26)
    expect(transitions.fadeOut.duration).toBe(0.1)
    expect(transitions.fadeIn).toMatchObject({ duration: 0.2, delay: 0.1 })
  })

  it('moves a step that respects reduced motion when the reader has not asked for less', () => {
    const transitions = getStepTransitions({
      respectsReducedMotion: true,
      prefersReducedMotion: false,
      easesHeight: true,
    })

    expect(transitions.height.duration).toBe(0.26)
  })

  it('holds the height still when only the step changes size by itself', () => {
    expect(
      getStepTransitions({ respectsReducedMotion: false, prefersReducedMotion: false, easesHeight: false }).height
        .duration,
    ).toBe(0)
  })
})
