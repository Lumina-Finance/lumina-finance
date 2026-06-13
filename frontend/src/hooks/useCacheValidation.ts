import { useEffect, useRef } from 'react'
import { focusManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { fetchCacheStatus } from '@/api/user'
import { invalidateAppData, invalidateFxData } from '@/api/cache/invalidation'

const PERSONAL_CACHE_CHANGED_AT_KEY_PREFIX = 'lumina:personal-cache-changed-at'
const FX_REFRESHED_AT_KEY_PREFIX = 'lumina:fx-refreshed-at'
const FX_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000

export function useCacheValidation(userId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient()
  const validatingRef = useRef(false)
  const pendingValidationRef = useRef(false)

  useEffect(() => {
    if (!enabled || !userId) return

    const validate = async () => {
      if (validatingRef.current) {
        pendingValidationRef.current = true
        return
      }
      validatingRef.current = true
      try {
        do {
          pendingValidationRef.current = false
          let appInvalidated = false
          try {
            appInvalidated = await validateAppData(queryClient, userId)
          } catch {
            appInvalidated = false
          }
          validateFxData(queryClient, userId, appInvalidated)
        } while (pendingValidationRef.current)
      } finally {
        validatingRef.current = false
      }
    }

    void validate()
    const unsubscribeFocus = focusManager.subscribe((focused) => {
      if (focused) void validate()
    })
    return () => {
      unsubscribeFocus()
    }
  }, [enabled, queryClient, userId])
}

async function validateAppData(
  queryClient: QueryClient,
  userId: string,
) {
  const storageKey = `${PERSONAL_CACHE_CHANGED_AT_KEY_PREFIX}:${userId}`
  const status = await fetchCacheStatus()
  const currentChangedAt = toUtcCacheTimestamp(status.personal.changed_at) ?? ''
  const previousChangedAt = toUtcCacheTimestamp(window.localStorage.getItem(storageKey))
  window.localStorage.setItem(storageKey, currentChangedAt)

  if (
    previousChangedAt === null
    || previousChangedAt === currentChangedAt
    || status.personal.last_change_from_current_session
  ) {
    return false
  }

  invalidateAppData(queryClient)
  return true
}

function toUtcCacheTimestamp(value: string | null) {
  if (!value) return value

  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value

  return new Date(time).toISOString()
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
