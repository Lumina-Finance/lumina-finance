/** How long a control's content and width take to change, the app's default ease over 300ms */
export const CONTENT_EASE_MS = 300
export const CONTENT_EASE_CURVE = [0.22, 1, 0.36, 1] as const

/**
 * Whether the person asks for less motion right now. Read at the moment of a change rather than held by
 * a hook, which keeps the setting it saw when the control mounted, so a dialog left open while the
 * setting is switched still follows it
 */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A width changes by less than this many pixels without anyone seeing it, so it is not eased */
const VISIBLE_WIDTH_CHANGE_PX = 0.5

/**
 * The keyframes that ease an element's width from the one it was drawn at to the one it has now
 *
 * Both ends are pixel measurements, which is what lets a width ease to or from `auto`, as CSS can't.
 * Under reduced motion, or for a change nobody would see, there are none and the width simply changes
 */
export function getWidthEaseKeyframes(from: number, to: number, shouldReduceMotion: boolean): Keyframe[] | null {
  if (shouldReduceMotion || Math.abs(to - from) < VISIBLE_WIDTH_CHANGE_PX) return null
  return [{ width: `${from}px` }, { width: `${to}px` }]
}

/** The room left clear beyond the end of a word fading while its button's width eases, so it never touches the button's end */
export const FADE_FIT_MARGIN_PX = 4

/**
 * Where in a width ease, as a share of the way from the old width to the new, the incoming content has the
 * room it needs and the outgoing content loses it
 *
 * Content is cut by the button's edge whenever the width is narrower than it reaches, so the incoming content
 * stays invisible until the width has grown to hold it, and the outgoing content is gone before the width
 * shrinks past it. A reach is how far the content's end sits from the button's left edge. A share is of the
 * eased progress, which the width and the fade both follow, so a share of 0.4 is the same instant for both.
 * The incoming share is 0 when the width never lacks room for it, and the outgoing share is 1 when it never does
 */
export function getFadeFitShares(
  from: number,
  to: number,
  incomingReach: number,
  outgoingReach: number,
  marginPx = FADE_FIT_MARGIN_PX,
): { incomingStart: number; outgoingEnd: number } {
  const clamp = (share: number) => Math.min(1, Math.max(0, share))
  const change = to - from
  const incomingStart = change > 0 ? clamp((incomingReach + marginPx - from) / change) : 0
  const outgoingEnd = change < 0 ? clamp((from - outgoingReach - marginPx) / -change) : 1
  return { incomingStart, outgoingEnd }
}

/** The share of the eased progress where the old word is gone and the new one may begin, 34ms into the 300ms curve */
export const WORD_SWAP_SPLIT = 0.45

/**
 * The shares between which two words swap in a fitted button. The old word is fully faded out by the split and
 * the new one only begins after it, so the two are never on screen together, and neither is cut by the button's
 * end. Each depends on the split and its own reach alone, so a word works out its share without the other's
 */
export function getWordSwapShares(
  from: number,
  to: number,
  incomingReach: number,
  outgoingReach: number,
): { incomingStart: number; outgoingEnd: number } {
  const { incomingStart, outgoingEnd } = getFadeFitShares(from, to, incomingReach, outgoingReach)
  return {
    incomingStart: Math.max(incomingStart, WORD_SWAP_SPLIT),
    outgoingEnd: Math.min(outgoingEnd, WORD_SWAP_SPLIT),
  }
}
