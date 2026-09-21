import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { LOADING_VISIBILITY_MS } from '@/components/loading/Transition'

const DEFAULT_LOADING_MIN_MS = 800

type UseLoadingSnapshotOptions<T> = {
  snapshot: T
  loading?: boolean
  transitionKey: string
  minVisibleMs?: number

  /**
   * Hold for a transition key change with nothing loading behind it, which is a swap between two
   * values already in hand rather than a wait for one. Defaults to the shared crossfade duration
   * and keeps the spinner out of that transition
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
 * Holds a stable snapshot of data behind a minimum-duration loading state, so a quick fetch still
 * shows the loading UI for at least `minVisibleMs` instead of flashing
 *
 * A concealment starts whenever `loading` is true or `transitionKey` changes, even if `loading` is
 * already false, and only reveals the latest `snapshot` once both loading has ended and the minimum
 * time has elapsed. Skips the minimum hold when the user prefers reduced motion
 *
 * A key change with nothing loading behind it uses `swapMinVisibleMs` to conceal and reveal the
 * cached value without a loading spinner
 */
export function useLoadingSnapshot<T>({
  snapshot,
  loading = false,
  transitionKey,
  minVisibleMs = DEFAULT_LOADING_MIN_MS,
  swapMinVisibleMs = LOADING_VISIBILITY_MS,
}: UseLoadingSnapshotOptions<T>): LoadingSnapshotState<T> {
  const [displaySnapshot, setDisplaySnapshot] = useState<T>(snapshot)
  const [contentConcealed, setContentConcealed] = useState(loading)
  const [loadingVisible, setLoadingVisible] = useState(loading)
  const loadingStartedAtRef = useRef<number | null>(null)
  const transitionKeyRef = useRef(transitionKey)
  const swappingRef = useRef(false)
  const concealFrameRef = useRef<number | null>(null)
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
      concealFrameRef.current = null
      setContentConcealed(true)
      setLoadingVisible(!swappingRef.current)
    })
    concealFrameRef.current = frameId

    return () => {
      window.cancelAnimationFrame(frameId)
      if (concealFrameRef.current === frameId) concealFrameRef.current = null
    }
  }, [loading, swapMinVisibleMs, transitionKey])

  useEffect(() => {
    if (loading) return undefined

    const loadingStartedAt = loadingStartedAtRef.current
    const holdMs = swappingRef.current && swapMinVisibleMs !== undefined ? swapMinVisibleMs : minVisibleMs
    const remainingLoadingMs = loadingStartedAt === null
      ? 0
      : Math.max(0, holdMs - (Date.now() - loadingStartedAt))

    const finishTimeoutId = window.setTimeout(() => {
      // A delayed frame must not conceal the snapshot after its reveal has completed
      if (concealFrameRef.current !== null) {
        window.cancelAnimationFrame(concealFrameRef.current)
        concealFrameRef.current = null
      }
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
