import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

const DEFAULT_LOADING_MIN_MS = 800

type UseLoadingSnapshotOptions<T> = {
  snapshot: T
  loading?: boolean
  transitionKey: string
  minVisibleMs?: number

  /**
   * Hold for a transition key change with nothing loading behind it, which is a swap between two
   * values already in hand rather than a wait for one. Passing a duration keeps the spinner out of
   * that transition, so the new value conceals and comes back rather than sitting behind a load
   * that already finished. Left out, a swap is held and labelled exactly like a load
   */
  swapMinVisibleMs?: number
}

type LoadingSnapshotState<T> = {
  displaySnapshot: T
  contentConcealed: boolean
  loadingVisible: boolean
  shouldReduceMotion: boolean
}

/**
 * Holds a stable snapshot of data behind a minimum-duration loading state, so a quick fetch or a
 * transition to new data still shows the loading UI for at least `minVisibleMs` instead of flashing
 *
 * A concealment starts whenever `loading` is true or `transitionKey` changes, even if `loading` is
 * already false, and only reveals the latest `snapshot` once both loading has ended and the minimum
 * time has elapsed. Skips the minimum hold when the user prefers reduced motion
 *
 * A key change with nothing loading behind it can be held on its own terms, which is what
 * `swapMinVisibleMs` is for
 */
export function useLoadingSnapshot<T>({
  snapshot,
  loading = false,
  transitionKey,
  minVisibleMs = DEFAULT_LOADING_MIN_MS,
  swapMinVisibleMs,
}: UseLoadingSnapshotOptions<T>): LoadingSnapshotState<T> {
  const [displaySnapshot, setDisplaySnapshot] = useState<T>(snapshot)
  const [contentConcealed, setContentConcealed] = useState(loading)
  const [loadingVisible, setLoadingVisible] = useState(loading)
  const loadingStartedAtRef = useRef<number | null>(null)
  const transitionKeyRef = useRef(transitionKey)
  const swappingRef = useRef(false)
  const shouldReduceMotion = useReducedMotion() ?? false

  useEffect(() => {
    const transitionChanged = transitionKeyRef.current !== transitionKey
    if (transitionChanged) {
      transitionKeyRef.current = transitionKey
    }

    if (!loading && !transitionChanged) return undefined

    // A load starting mid-swap takes the transition over, so the spinner still appears for the
    // wait it introduces
    swappingRef.current = !loading && swapMinVisibleMs !== undefined
    loadingStartedAtRef.current = Date.now()
    const frameId = window.requestAnimationFrame(() => {
      setContentConcealed(true)
      setLoadingVisible(!swappingRef.current)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [loading, swapMinVisibleMs, transitionKey])

  useEffect(() => {
    if (loading) return undefined

    const loadingStartedAt = loadingStartedAtRef.current
    const holdMs = swappingRef.current && swapMinVisibleMs !== undefined ? swapMinVisibleMs : minVisibleMs
    const remainingLoadingMs = loadingStartedAt === null
      ? 0
      : Math.max(0, holdMs - (Date.now() - loadingStartedAt))

    const finishTimeoutId = window.setTimeout(() => {
      setDisplaySnapshot(snapshot)
      setLoadingVisible(false)
      setContentConcealed(false)
      loadingStartedAtRef.current = null
      swappingRef.current = false
    }, shouldReduceMotion ? 0 : remainingLoadingMs)

    return () => window.clearTimeout(finishTimeoutId)
  }, [loading, minVisibleMs, shouldReduceMotion, snapshot, swapMinVisibleMs, transitionKey])

  return {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  }
}
