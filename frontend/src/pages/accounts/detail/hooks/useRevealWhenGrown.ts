import { useCallback, useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'

/**
 * Brings an element that grows in at the foot of a dialog's scrolling body into view once it has grown,
 * scrolling the body only as far as the whole element needs, and not at all when it already shows
 *
 * `reveal` goes in the element's `onAnimationComplete` and returns the element it brought into view. The
 * end of an exit animation brings nothing into view and returns null, since an element on its way out
 * keeps the props it last rendered with, so whether it is shown is read when the animation ends
 */
export function useRevealWhenGrown<T extends HTMLElement>(isShown: boolean) {
  const ref = useRef<T>(null)
  const shouldReduceMotion = useReducedMotion()
  const isShownRef = useRef(isShown)
  useEffect(() => {
    isShownRef.current = isShown
  }, [isShown])

  const reveal = useCallback(() => {
    const element = ref.current
    if (!isShownRef.current || !element) return null
    // Scrolling lines the element up with the edge of what the body shows, which would scroll the body's
    // own bottom padding out of sight and leave the element flush on the footer, so the element keeps
    // that padding below it as its scroll margin
    let body = element.parentElement
    while (body && !['auto', 'scroll'].includes(getComputedStyle(body).overflowY)) body = body.parentElement
    if (body) element.style.scrollMarginBottom = getComputedStyle(body).paddingBottom
    element.scrollIntoView({ behavior: shouldReduceMotion ? 'auto' : 'smooth', block: 'nearest' })
    return element
  }, [shouldReduceMotion])

  return { ref, reveal }
}
