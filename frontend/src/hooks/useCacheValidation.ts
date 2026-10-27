import { useEffect, useRef } from 'react'
import { focusManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { User } from '@/api/auth'
import { fetchCacheStatus, fetchProfile } from '@/api/user'
import { invalidateAppData, invalidateFxData } from '@/api/cache/invalidation'
import { readStoredValue, writeStoredValue } from '@/utils/browserStorage'

const PERSONAL_CACHE_CHANGED_AT_KEY_PREFIX = 'lumina:personal-cache-changed-at'
const CALCULATION_DATE_TOKEN_KEY_PREFIX = 'lumina:calculation-date-token'
const FX_REFRESHED_AT_KEY_PREFIX = 'lumina:fx-refreshed-at'
const FX_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000
const CACHE_STATUS_RETRY_INTERVAL_MS = 60 * 1000

/**
 * Counts the holds on a task, so it stays back while any hold is open and listeners hear when the
 * last one ends. A hold is released once, so a repeated release can't take another hold's place
 */
export function createHoldGate() {
  let holdCount = 0
  const releaseListeners = new Set<() => void>()

  return {
    hold() {
      holdCount += 1
      let released = false
      return () => {
        if (released) return
        released = true
        holdCount -= 1
        if (holdCount === 0) releaseListeners.forEach((listener) => listener())
      }
    },
    isHeld: () => holdCount > 0,
    onRelease(listener: () => void) {
      releaseListeners.add(listener)
      return () => { releaseListeners.delete(listener) }
    },
  }
}

/**
 * Runs `task` when a caller's attempt finds the gate open, or once the last hold ends if an
 * attempt was skipped meanwhile
 */
export function createHeldRunner(gate: ReturnType<typeof createHoldGate>, task: () => void) {
  let skipped = false
  const unsubscribe = gate.onRelease(() => {
    if (!skipped) return
    skipped = false
    task()
  })

  return {
    attempt() {
      if (!gate.isHeld()) return true
      skipped = true
      return false
    },
    dispose: unsubscribe,
  }
}

// Shared by every mounted component, since the dialogues that hold the check sit far below the
// app shell that runs it
const cacheValidationGate = createHoldGate()

/**
 * Holds every cache check back while `held` is true, so a dialogue that defers its own refresh
 * until it closes keeps the data under it as it was. A check skipped meanwhile runs once the last
 * hold ends, so a change made elsewhere still reaches the page
 */
export function useHoldCacheValidation(held: boolean) {
  useEffect(() => {
    if (!held) return
    return cacheValidationGate.hold()
  }, [held])
}

/**
 * Revalidates cached app and FX data on mount, focus, and the next calculation owner's midnight,
 * comparing server changes and owner-local dates with this window's last result for `userId`
 *
 * Personal data invalidates the app cache when its server timestamp differs from this window's copy,
 * even if another window shares the same login session. A new owner-local date also refreshes calculations
 * without requiring a transaction edit. FX data refreshes at most once every twelve
 * hours, or immediately when app data was just invalidated. Overlapping validate calls are coalesced,
 * and calls made while `useHoldCacheValidation` holds the check become one call when it ends. A server
 * change also fetches the profile again and hands it to `onProfileRefreshed`
 */
export function useCacheValidation(
  userId: string | undefined,
  enabled: boolean,
  onProfileRefreshed: (profile: User) => void,
) {
  const queryClient = useQueryClient()
  const validatingRef = useRef(false)
  const pendingValidationRef = useRef(false)

  useEffect(() => {
    if (!enabled || !userId) return
    let midnightTimer: ReturnType<typeof setTimeout> | undefined
    let active = true
    const heldRunner = createHeldRunner(cacheValidationGate, () => { void validate() })

    const scheduleMidnightCheck = (nextBoundaryAt: string) => {
      if (!active) return
      clearTimeout(midnightTimer)
      const remaining = Date.parse(nextBoundaryAt) - Date.now()
      if (!Number.isFinite(remaining)) return
      midnightTimer = setTimeout(() => { void validate() }, remaining > 0 ? remaining + 1000 : CACHE_STATUS_RETRY_INTERVAL_MS)
    }

    const scheduleRetry = () => {
      if (!active) return
      clearTimeout(midnightTimer)
      midnightTimer = setTimeout(() => { void validate() }, CACHE_STATUS_RETRY_INTERVAL_MS)
    }

    // A profile change in another session marks the same personal cache as app data, so the profile
    // is fetched again with it, and on the next check too when that fetch failed. A sign-out while it
    // loads stops the effect, which drops the answer
    let profileStale = false
    const refreshProfile = () => {
      fetchProfile()
        .then((profile) => {
          profileStale = false
          if (active) onProfileRefreshed(profile)
        })
        .catch(() => { profileStale = true })
    }

    const validate = async () => {
      if (!heldRunner.attempt()) return
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
            const result = await validateAppData(queryClient, userId)
            appInvalidated = result.appInvalidated
            if (result.changed || profileStale) refreshProfile()
            scheduleMidnightCheck(result.nextBoundaryAt)
          } catch {
            appInvalidated = false
            scheduleRetry()
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
    const onWindowFocus = () => { void validate() }
    const onStorageChange = (event: StorageEvent) => {
      const changedAtKey = `${PERSONAL_CACHE_CHANGED_AT_KEY_PREFIX}:${userId}`
      const dateKey = `${CALCULATION_DATE_TOKEN_KEY_PREFIX}:${userId}`
      if (
        event.storageArea === window.localStorage
        && (event.key === changedAtKey || event.key === dateKey)
        && event.newValue !== null
        && event.newValue !== readStoredValue(event.key, 'session')
        && document.visibilityState === 'visible'
      ) void validate()
    }
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('storage', onStorageChange)
    return () => {
      active = false
      clearTimeout(midnightTimer)
      heldRunner.dispose()
      unsubscribeFocus()
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('storage', onStorageChange)
    }
  }, [enabled, onProfileRefreshed, queryClient, userId])
}

async function validateAppData(
  queryClient: QueryClient,
  userId: string,
) {
  const storageKey = `${PERSONAL_CACHE_CHANGED_AT_KEY_PREFIX}:${userId}`
  const dateStorageKey = `${CALCULATION_DATE_TOKEN_KEY_PREFIX}:${userId}`
  const status = await fetchCacheStatus()
  const currentChangedAt = toUtcCacheTimestamp(status.personal.changed_at) ?? ''
  const previousChangedAt = toUtcCacheTimestamp(
    readStoredValue(storageKey, 'session') ?? readStoredValue(storageKey),
  )
  const previousDate = readStoredValue(dateStorageKey, 'session') ?? readStoredValue(dateStorageKey)
  writeStoredValue(storageKey, currentChangedAt, 'session')
  writeStoredValue(dateStorageKey, status.calculation_date_token, 'session')
  if (readStoredValue(storageKey) !== currentChangedAt) {
    writeStoredValue(storageKey, currentChangedAt)
  }
  if (readStoredValue(dateStorageKey) !== status.calculation_date_token) {
    writeStoredValue(dateStorageKey, status.calculation_date_token)
  }

  const changed = previousChangedAt !== null && previousChangedAt !== currentChangedAt
  const dayChanged = previousDate !== null && previousDate !== status.calculation_date_token
  if (changed || dayChanged) invalidateAppData(queryClient)
  return { appInvalidated: changed || dayChanged, changed, nextBoundaryAt: status.next_calculation_boundary_at }
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
  const previousRefreshedAt = readStoredValue(storageKey)

  if (previousRefreshedAt === null || appInvalidated) {
    writeStoredValue(storageKey, String(now))
    return
  }

  const previousTime = Number(previousRefreshedAt)
  if (Number.isFinite(previousTime) && now - previousTime < FX_REFRESH_INTERVAL_MS) return

  invalidateFxData(queryClient)
  writeStoredValue(storageKey, String(now))
}
