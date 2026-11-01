import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { CONTENT_EASE_CURVE, CONTENT_EASE_MS, getWidthEaseKeyframes, prefersReducedMotion } from '@/utils/widthEase'

const EASE_ANIMATION_ID = 'eased-width'

/**
 * Eases an element to its new width whenever `changeKey` changes, from the width it was drawn at
 *
 * The element takes its new width from its own styles at once, whatever they say, `auto` included,
 * and this plays the way there from the measured old width. A change that arrives while one is still
 * playing starts from where the element is drawn. Its CSS must leave `width` out of its transition,
 * or that transition would hold the width at the old value while this measures the new one. Under
 * reduced motion nothing plays
 *
 * `onEase` is told the two widths, whether or not anything plays, in the same layout effect and before
 * the paint, for content that fades to follow the width
 */
export function useEasedWidth(
  ref: RefObject<HTMLElement | null>,
  changeKey: unknown,
  onEase?: (from: number, to: number) => void,
): void {
  const drawnWidth = useRef(0)
  const lastKey = useRef(changeKey)
  const onEaseRef = useRef(onEase)

  // Declared ahead of the effect that plays the ease, so that effect calls the callback of this render
  useLayoutEffect(() => {
    onEaseRef.current = onEase
  })

  // The width the element rests at, kept current through resizes of the window and its container
  useEffect(() => {
    const element = ref.current
    if (!element) return
    drawnWidth.current = element.offsetWidth
    const observer = new ResizeObserver(() => {
      drawnWidth.current = element.offsetWidth
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  // Runs before the browser paints the new state, so the first frame is already the old width
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || Object.is(lastKey.current, changeKey)) return
    lastKey.current = changeKey

    const playing = element.getAnimations().filter((animation) => animation.id === EASE_ANIMATION_ID)
    const from = playing.length > 0 ? element.offsetWidth : drawnWidth.current
    for (const animation of playing) animation.cancel()

    const to = element.offsetWidth
    drawnWidth.current = to
    onEaseRef.current?.(from, to)
    const keyframes = getWidthEaseKeyframes(from, to, prefersReducedMotion())
    if (!keyframes) return
    element.animate(keyframes, {
      id: EASE_ANIMATION_ID,
      duration: CONTENT_EASE_MS,
      easing: `cubic-bezier(${CONTENT_EASE_CURVE.join(', ')})`,
    })
  }, [ref, changeKey])
}
