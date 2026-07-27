import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'

const DEFAULT_LOADING_MIN_MS = 800

type UseLoadingSnapshotOptions<T> = {
  snapshot: T
  loading?: boolean
  transitionKey: string
  minVisibleMs?: number
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
 */
export function useLoadingSnapshot<T>({
  snapshot,
  loading = false,
  transitionKey,
  minVisibleMs = DEFAULT_LOADING_MIN_MS,
}: UseLoadingSnapshotOptions<T>): LoadingSnapshotState<T> {
  const [displaySnapshot, setDisplaySnapshot] = useState<T>(snapshot)
  const [contentConcealed, setContentConcealed] = useState(loading)
  const [loadingVisible, setLoadingVisible] = useState(loading)
  const loadingStartedAtRef = useRef<number | null>(null)
  const transitionKeyRef = useRef(transitionKey)
  const shouldReduceMotion = useReducedMotion() ?? false

  useEffect(() => {
    const transitionChanged = transitionKeyRef.current !== transitionKey
    if (transitionChanged) {
      transitionKeyRef.current = transitionKey
    }

    if (!loading && !transitionChanged) return undefined

    loadingStartedAtRef.current = Date.now()
    const frameId = window.requestAnimationFrame(() => {
      setContentConcealed(true)
      setLoadingVisible(true)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [loading, transitionKey])

  useEffect(() => {
    if (loading) return undefined

    const loadingStartedAt = loadingStartedAtRef.current
    const remainingLoadingMs = loadingStartedAt === null
      ? 0
      : Math.max(0, minVisibleMs - (Date.now() - loadingStartedAt))

    const finishTimeoutId = window.setTimeout(() => {
      setDisplaySnapshot(snapshot)
      setLoadingVisible(false)
      setContentConcealed(false)
      loadingStartedAtRef.current = null
    }, shouldReduceMotion ? 0 : remainingLoadingMs)

    return () => window.clearTimeout(finishTimeoutId)
  }, [loading, minVisibleMs, shouldReduceMotion, snapshot, transitionKey])

  return {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  }
}
