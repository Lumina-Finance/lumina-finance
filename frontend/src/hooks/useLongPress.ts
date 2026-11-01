import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'

/** How long a control is held before the press counts as a long one */
export const LONG_PRESS_MS = 600

type LongPressOptions = {
  onPress: () => void
  onLongPress: () => void

  /** While true, nothing starts, so a control held off for a reason neither presses nor long-presses */
  disabled?: boolean
  durationMs?: number
}

const HOLD_KEYS = new Set(['Enter', ' '])

/**
 * Tells a short press from a long one on a button, by pointer, touch or key, and reports whether one is
 * under way so the control can draw its progress. `isFinished` stays true from the moment a press counts
 * as long until the next press starts, so the progress can ease out instead of clearing at once
 *
 * A press shorter than the duration runs `onPress` once, from the click for a pointer and on release for
 * a key. Holding past the duration runs `onLongPress` once, while the press is still down, and the
 * click or key release that follows does nothing. Letting go early, leaving the control, a cancelled
 * touch, a scroll or losing focus drops the press with neither running. A held key is taken over from
 * the browser, which would otherwise repeat the click, and the context menu a touch long press
 * opens is refused
 */
export function useLongPress({ onPress, onLongPress, disabled = false, durationMs = LONG_PRESS_MS }: LongPressOptions) {
  const [isPressing, setIsPressing] = useState(false)
  const [isFinished, setIsFinished] = useState(false)
  const timerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const keyHeldRef = useRef(false)
  const latestRef = useRef({ onPress, onLongPress })

  useEffect(() => {
    latestRef.current = { onPress, onLongPress }
  })

  const cancel = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    keyHeldRef.current = false
    setIsPressing(false)
  }, [])

  const start = useCallback(() => {
    cancel()
    longPressFiredRef.current = false
    setIsFinished(false)
    setIsPressing(true)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      longPressFiredRef.current = true
      setIsFinished(true)
      setIsPressing(false)
      latestRef.current.onLongPress()
    }, durationMs)
  }, [cancel, durationMs])

  // A control held off while pressed drops the press, and one removed while pressed never fires it
  useEffect(() => {
    if (!disabled) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
    keyHeldRef.current = false
  }, [disabled])

  // Dropped for good rather than only hidden, or the progress would come back full when the control is enabled again
  if (disabled && isPressing) setIsPressing(false)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    [],
  )

  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (disabled || !event.isPrimary || event.button !== 0) return
      start()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onBlur: cancel,
    onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (disabled) return
      if (longPressFiredRef.current) {
        longPressFiredRef.current = false
        event.preventDefault()
        return
      }
      // Keys never click, since their default is refused above, so this is a pointer or an assistive
      // technology activating the control, which has no way to hold
      latestRef.current.onPress()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (disabled || !HOLD_KEYS.has(event.key)) return
      // Enter would click at once and again for as long as it is held, and Space would click on release
      event.preventDefault()
      if (event.repeat || keyHeldRef.current) return
      start()
      keyHeldRef.current = true
    },
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
      if (disabled || !HOLD_KEYS.has(event.key) || !keyHeldRef.current) return
      event.preventDefault()
      const wasShort = timerRef.current !== null
      cancel()
      if (wasShort) latestRef.current.onPress()
    },
  }

  return { isPressing, isFinished, handlers }
}
