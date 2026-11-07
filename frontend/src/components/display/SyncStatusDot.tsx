import { useEffect } from 'react'
import { useAnimate, useReducedMotion } from 'motion/react'

/**
 * The colour family of a bank sync state: the app is working on it, it is up to date, it needs the
 * user's attention without being broken, such as waiting on their review, it is stopped until the user fixes it, or the account does not sync at all
 */
export type SyncStatusTone = 'working' | 'ok' | 'review' | 'stopped' | 'off'

const TONE_COLORS: Record<SyncStatusTone, string> = {
  working: 'var(--app-bank)',
  ok: 'var(--app-positive)',
  review: 'var(--app-warning-dot)',
  stopped: 'var(--app-negative)',
  off: 'var(--app-text-subtle)',
}

const SIZE_CLASSES = { sm: 'h-2 w-2', md: 'h-2.5 w-2.5' } as const

// A slow blink that stays inside the dot's own box, so a pulsing dot never reaches past the label's
// column the way a spreading ring would
const BLINK_ANIMATE = { opacity: [1, 0.25, 1] }
const BLINK_TRANSITION = { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } as const
const SETTLE_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] } as const

type SyncStatusDotProps = {
  tone: SyncStatusTone

  // Blinks while the app is fetching, and holds still for anyone who asks for reduced motion
  pulse?: boolean
  size?: keyof typeof SIZE_CLASSES
}

/**
 * The coloured light beside every bank sync status. Only the dot carries the state's colour, so the
 * label beside it stays in plain text. It blinks while the app is fetching and is hollow for an
 * account that does not sync
 */
export function SyncStatusDot({ tone, pulse = false, size = 'sm' }: SyncStatusDotProps) {
  const prefersReducedMotion = useReducedMotion()
  const [dot, animate] = useAnimate<HTMLSpanElement>()
  const color = TONE_COLORS[tone]
  const isBlinking = pulse && !prefersReducedMotion

  // Played from here rather than through the element's own animate prop, which skips its first
  // animation inside a presence that skips its children's, such as a modal's opening view, so a dot
  // shown already fetching would never blink there
  useEffect(() => {
    const animation = isBlinking
      ? animate(dot.current, BLINK_ANIMATE, BLINK_TRANSITION)
      : animate(dot.current, { opacity: 1 }, SETTLE_TRANSITION)
    return () => animation.stop()
  }, [animate, dot, isBlinking])

  return (
    <span
      ref={dot}
      className={`inline-flex shrink-0 rounded-full transition-colors${SIZE_CLASSES[size]}`}
      style={{ background: tone === 'off' ? 'transparent' : color, border: `1.5px solid ${color}` }}
      data-testid="sync-status-dot"
      aria-hidden
    />
  )
}
