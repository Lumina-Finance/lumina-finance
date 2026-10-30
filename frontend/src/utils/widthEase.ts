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
