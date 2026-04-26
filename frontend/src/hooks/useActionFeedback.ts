import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActionFeedbackStatus } from '@/components/ActionFeedbackButton'

const DEFAULT_MINIMUM_LOADING_MS = 1000
const DEFAULT_SUCCESS_MS = 1200

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

interface UseActionFeedbackOptions {
  minimumLoadingMs?: number
  successMs?: number
}

export function useActionFeedback({
  minimumLoadingMs = DEFAULT_MINIMUM_LOADING_MS,
  successMs = DEFAULT_SUCCESS_MS,
}: UseActionFeedbackOptions = {}) {
  const [status, setStatus] = useState<ActionFeedbackStatus>('idle')
  const mountedRef = useRef(true)

  useEffect(() => () => {
    mountedRef.current = false
  }, [])

  const setMountedStatus = useCallback((nextStatus: ActionFeedbackStatus) => {
    if (mountedRef.current) setStatus(nextStatus)
  }, [])

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setMountedStatus('loading')
    const startedAt = performance.now()

    try {
      const result = await action()
      const remaining = minimumLoadingMs - (performance.now() - startedAt)
      if (remaining > 0) await sleep(remaining)
      setMountedStatus('success')
      await sleep(successMs)
      setMountedStatus('idle')
      return result
    } catch (error) {
      const remaining = minimumLoadingMs - (performance.now() - startedAt)
      if (remaining > 0) await sleep(remaining)
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
