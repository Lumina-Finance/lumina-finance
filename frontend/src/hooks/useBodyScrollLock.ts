import { useEffect } from 'react'

// Below this width modals go fullscreen, and mobile browsers keep scrolling the body through an
// overlay even with overflow hidden, so the body is pinned in place instead
const FULLSCREEN_MODAL_QUERY = '(max-width: 1049.98px)'

let lockCount = 0
let releaseScroll: (() => void) | null = null

/**
 * Pins the page and returns a function that restores it
 *
 * On wide screens overflow hidden is enough. On narrow screens it is not, since touch scrolling still
 * moves the body behind the overlay, so the body is fixed at its current offset and the scroll position
 * is restored on release. The fullscreen modal covers the pinned page, so the shift is never seen
 */
function pinScroll(): () => void {
  const { body } = document
  body.classList.add('app-body-scroll-locked')

  const pinBody = window.matchMedia?.(FULLSCREEN_MODAL_QUERY)?.matches ?? false
  if (!pinBody) {
    const previousOverflow = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = previousOverflow
      body.classList.remove('app-body-scroll-locked')
    }
  }

  const scrollY = window.scrollY
  const previous = {
    overflow: body.style.overflow,
    position: body.style.position,
    top: body.style.top,
    width: body.style.width,
  }
  body.style.overflow = 'hidden'
  body.style.position = 'fixed'
  body.style.top = `-${scrollY}px`
  body.style.width = '100%'
  return () => {
    body.style.overflow = previous.overflow
    body.style.position = previous.position
    body.style.top = previous.top
    body.style.width = previous.width
    body.classList.remove('app-body-scroll-locked')
    window.scrollTo(0, scrollY)
  }
}

/**
 * Locks page scroll while any modal is open, coordinating stacked modals through a shared count so the
 * page is only pinned on the first lock and only restored once the last one releases
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return undefined

    if (lockCount === 0) releaseScroll = pinScroll()
    lockCount += 1

    return () => {
      lockCount -= 1
      if (lockCount > 0) return

      releaseScroll?.()
      releaseScroll = null
    }
  }, [locked])
}
