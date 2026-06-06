import { useEffect, useRef } from 'react'
import { focusManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { LOCAL_CACHE_CHANGE_EVENT } from '@/api/client'
import { fetchCacheStatus } from '@/api/user'
import { invalidateAppData, invalidateFxData } from '@/api/cacheInvalidation'

const CACHE_CHANGED_AT_KEY_PREFIX = 'lumina:cache-changed-at'
const FX_REFRESHED_AT_KEY_PREFIX = 'lumina:fx-refreshed-at'
const FX_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000

export function useCacheValidation(userId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient()
  const validatingRef = useRef(false)
  const pendingLocalAcknowledgementRef = useRef(false)

  useEffect(() => {
    if (!enabled || !userId) return

    const validate = async (acknowledgeLocalChange = false) => {
      if (acknowledgeLocalChange) pendingLocalAcknowledgementRef.current = true
      if (validatingRef.current) return
      validatingRef.current = true
      try {
        do {
          const shouldAcknowledgeLocalChange = pendingLocalAcknowledgementRef.current
          pendingLocalAcknowledgementRef.current = false
          let appInvalidated = false
          try {
            appInvalidated = await validateAppData(queryClient, userId, shouldAcknowledgeLocalChange)
          } catch {
            appInvalidated = false
          }
          validateFxData(queryClient, userId, appInvalidated)
        } while (pendingLocalAcknowledgementRef.current)
      } finally {
        validatingRef.current = false
      }
    }

    void validate()
    const unsubscribeFocus = focusManager.subscribe((focused) => {
      if (focused) void validate()
    })
    const acknowledgeLocalChange = () => {
      void validate(true)
    }
    window.addEventListener(LOCAL_CACHE_CHANGE_EVENT, acknowledgeLocalChange)
    return () => {
      unsubscribeFocus()
      window.removeEventListener(LOCAL_CACHE_CHANGE_EVENT, acknowledgeLocalChange)
    }
  }, [enabled, queryClient, userId])
}

async function validateAppData(
  queryClient: QueryClient,
  userId: string,
  acknowledgeLocalChange: boolean,
) {
  const storageKey = `${CACHE_CHANGED_AT_KEY_PREFIX}:${userId}`
  const status = await fetchCacheStatus()
  const currentChangedAt = status.changed_at ?? ''
  const previousChangedAt = window.localStorage.getItem(storageKey)
  window.localStorage.setItem(storageKey, currentChangedAt)

  if (acknowledgeLocalChange || previousChangedAt === null || previousChangedAt === currentChangedAt) {
    return false
  }

  invalidateAppData(queryClient)
  return true
}

function validateFxData(
  queryClient: QueryClient,
  userId: string,
  appInvalidated: boolean,
) {
  const storageKey = `${FX_REFRESHED_AT_KEY_PREFIX}:${userId}`
  const now = Date.now()
  const previousRefreshedAt = window.localStorage.getItem(storageKey)

  if (previousRefreshedAt === null || appInvalidated) {
    window.localStorage.setItem(storageKey, String(now))
    return
  }

  const previousTime = Number(previousRefreshedAt)
  if (Number.isFinite(previousTime) && now - previousTime < FX_REFRESH_INTERVAL_MS) return

  invalidateFxData(queryClient)
  window.localStorage.setItem(storageKey, String(now))
}
