const EASE = [0.25, 0.1, 0.25, 1] as const
const HEIGHT_TRANSITION = { duration: 0.26, ease: EASE }

// The outgoing step is gone before the incoming one shows, so the two never sit over each other
const FADE_OUT_TRANSITION = { duration: 0.1, ease: EASE }
const FADE_IN_TRANSITION = { duration: 0.2, ease: EASE }
const INSTANT = { duration: 0 }

/**
 * The transitions between steps: the panel's height easing, the outgoing step fading out and the
 * incoming one fading in once the outgoing one has gone
 *
 * Everything is instant when the reader asks for less motion and the step respects it. A step that
 * does not respect it keeps its motion. The height eases only when `easesHeight` is
 */
export function getStepTransitions({
  respectsReducedMotion,
  prefersReducedMotion,
  easesHeight,
}: {
  respectsReducedMotion: boolean
  prefersReducedMotion: boolean
  easesHeight: boolean
}) {
  const reducesMotion = respectsReducedMotion && prefersReducedMotion

  return {
    height: easesHeight && !reducesMotion ? HEIGHT_TRANSITION : INSTANT,
    fadeIn: reducesMotion ? INSTANT : { ...FADE_IN_TRANSITION, delay: FADE_OUT_TRANSITION.duration },
    fadeOut: reducesMotion ? INSTANT : FADE_OUT_TRANSITION,
  }
}
