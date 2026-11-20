import { useEffect, useRef } from 'react'
import { focusManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { User } from '@/api/auth'
import { fetchCacheStatus, fetchProfile, fetchRatesStatus } from '@/api/user'
import { applyCheckAnswer, applyRatesDigest, getCheckRecord, toCheckAnswer } from '@/api/cache/cacheCheck'
import { QUERY_CACHE_STORAGE_KEY, readEntryObservedAt } from '@/api/cache/persistence'

const RATES_RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000
const CACHE_STATUS_RETRY_INTERVAL_MS = 60 * 1000

type CheckResult = { changed: boolean; nextBoundaryAt: string }

// The answer of the check made as the app opened, for the user it was made for, until the hook that
// would have made its first check takes it
let openingResult: (CheckResult & { userId: string }) | null = null

/**
 * Asks the server's change check as the app opens with a restored saved copy, before any screen shows
 * it, so answers nothing changed under count as fetched now and nothing else is requested
 *
 * Does nothing without a restored record, where the hook's first check records one. A check that
 * fails leaves the restored answers to the stale times they have, and the hook checks again
 */
export async function runOpeningCacheCheck(queryClient: QueryClient, userId: string) {
  openingResult = null
  if (getCheckRecord() === null) return
  try {
    openingResult = { userId, ...(await validateAppData(queryClient, true)) }
  } catch {
    openingResult = null
  }
}

/**
 * Whether a write of the saved entry that another tab made records a check there that this tab has
 * not seen, so this tab asks the check too. Writes that only save more answers carry the same time
 *
 * @param newValue - The entry the other tab wrote
 * @param knownObservedAt - The times this tab holds a record of or has been told of
 */
export function isNewObservation(newValue: string | null, knownObservedAt: (number | null)[]) {
  const observedAt = readEntryObservedAt(newValue)
  return observedAt !== null && !knownObservedAt.includes(observedAt)
}

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
      return () => {
        releaseListeners.delete(listener)
      }
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
 * Whether a dialogue holds the checks for changes made elsewhere back
 */
export function isCacheValidationHeld() {
  return cacheValidationGate.isHeld()
}

/**
 * Calls `listener` whenever the last hold ends, so another check for changes made elsewhere can wait
 * for the dialogue to close too
 *
 * @returns Stops calling it
 */
export function subscribeToCacheValidationRelease(listener: () => void) {
  return cacheValidationGate.onRelease(listener)
}

/**
 * Revalidates cached app and FX data on mount, focus, another tab's check and the next calculation
 * owner's midnight, comparing the server's answers with the record the saved entry keeps of what this
 * browser last saw
 *
 * A difference in the user's own or the shared change time or the server version invalidates the app
 * cache, even if another window shares the same login session. A new calculation date alone
 * invalidates only the covered answers marked as depending on the current date. A restored copy
 * whose check was made as the app opened takes that answer instead of asking again. Exchange rates
 * are asked separately, without waiting, on mount and at most once every twelve hours after: a digest
 * that differs from the record's, or none, invalidates what converts currencies. Overlapping validate
 * calls are coalesced, and calls made while `useHoldCacheValidation` holds the check become one call
 * when it ends. A server change also fetches the profile again and hands it to `onProfileRefreshed`
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
    let ratesAskedAt: number | null = null
    // The time another tab last recorded that this tab asked the check about. A tab seeing the same
    // time again only had more answers saved
    let toldObservedAt: number | null = null
    const heldRunner = createHeldRunner(cacheValidationGate, () => {
      void validate()
    })

    const scheduleMidnightCheck = (nextBoundaryAt: string) => {
      if (!active) return
      clearTimeout(midnightTimer)
      const remaining = Date.parse(nextBoundaryAt) - Date.now()
      if (!Number.isFinite(remaining)) return
      midnightTimer = setTimeout(
        () => {
          void validate()
        },
        remaining > 0 ? remaining + 1000 : CACHE_STATUS_RETRY_INTERVAL_MS,
      )
    }

    const scheduleRetry = () => {
      if (!active) return
      clearTimeout(midnightTimer)
      midnightTimer = setTimeout(() => {
        void validate()
      }, CACHE_STATUS_RETRY_INTERVAL_MS)
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
        .catch(() => {
          profileStale = true
        })
    }

    // Asked on its own, so opening never waits for it. A failed or late answer is dropped, and the
    // next check asks again
    const askRates = () => {
      const now = Date.now()
      if (ratesAskedAt !== null && now - ratesAskedAt < RATES_RECHECK_INTERVAL_MS) return
      ratesAskedAt = now
      fetchRatesStatus()
        .then(({ digest }) => {
          if (active) applyRatesDigest(queryClient, digest)
        })
        .catch(() => {
          ratesAskedAt = null
        })
    }

    const takeAnswer = (result: CheckResult) => {
      if (result.changed || profileStale) refreshProfile()
      scheduleMidnightCheck(result.nextBoundaryAt)
      askRates()
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
          try {
            takeAnswer(await validateAppData(queryClient, false))
          } catch {
            scheduleRetry()
          }
        } while (pendingValidationRef.current)
      } finally {
        validatingRef.current = false
      }
    }

    const opening = openingResult?.userId === userId ? openingResult : null
    openingResult = null
    if (opening) takeAnswer(opening)
    else void validate()
    const unsubscribeFocus = focusManager.subscribe((focused) => {
      if (focused) void validate()
    })
    const onWindowFocus = () => {
      void validate()
    }
    const onStorageChange = (event: StorageEvent) => {
      if (
        event.storageArea !== window.localStorage ||
        event.key !== QUERY_CACHE_STORAGE_KEY ||
        document.visibilityState !== 'visible' ||
        !isNewObservation(event.newValue, [toldObservedAt, getCheckRecord()?.observedAt ?? null])
      )
        return
      toldObservedAt = readEntryObservedAt(event.newValue)
      void validate()
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

async function validateAppData(queryClient: QueryClient, isOpening: boolean): Promise<CheckResult> {
  const status = await fetchCacheStatus()
  const { changed } = applyCheckAnswer(queryClient, toCheckAnswer(status), Date.now(), isOpening)
  return { changed, nextBoundaryAt: status.next_calculation_boundary_at }
}
