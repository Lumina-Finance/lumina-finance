import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionFeedbackStatus } from '@/components/feedback/ActionButton'
import { waitForMilliseconds } from '@/utils/timing'

const DEFAULT_MINIMUM_LOADING_MS = 1000
const DEFAULT_SUCCESS_MS = 1200

interface UseActionFeedbackOptions {
  minimumLoadingMs?: number
  successMs?: number
}

/**
 * Tracks the idle, loading, and success status of an async action run through the returned `run`
 * function, holding each state visible for at least its configured minimum duration
 *
 * Loading holds for at least `minimumLoadingMs` even if the action resolves or rejects sooner, and a
 * successful run then holds at `success` for `successMs` before returning to idle. State updates are
 * skipped after the component unmounts
 */
export function useActionFeedback({
  minimumLoadingMs = DEFAULT_MINIMUM_LOADING_MS,
  successMs = DEFAULT_SUCCESS_MS,
}: UseActionFeedbackOptions = {}) {
  const [status, setStatus] = useState<ActionFeedbackStatus>('idle')
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const setMountedStatus = useCallback((nextStatus: ActionFeedbackStatus) => {
    if (!mountedRef.current) return
    setStatus(nextStatus)
  }, [])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setMountedStatus('loading')
    const minimumLoading = waitForMilliseconds(minimumLoadingMs)

    try {
      const result = await action()
      await minimumLoading
      setMountedStatus('success')
      await waitForMilliseconds(successMs)
      setMountedStatus('idle')
      return result
    } catch (error) {
      await minimumLoading
      setMountedStatus('idle')
      throw error
    }
  }, [minimumLoadingMs, setMountedStatus, successMs])

  return {
    isPending: status !== 'idle',
    run,
    status,
  }
}
