import type { QueryClient } from '@tanstack/react-query'
import { isCoveredQuery, isDateDependentQuery } from '@/api/cache/coveredQueries'
import { invalidateAppData, invalidateFxData } from '@/api/cache/invalidation'
import type { CacheStatus } from '@/api/user/types'

const DAY_MS = 24 * 60 * 60 * 1000

// How long restored answers can go on counting as current with no difference found. A full fetch is
// forced after it, so a change no marker records can't stay hidden for longer
export const FULL_FETCH_MAX_AGE_MS = 30 * DAY_MS

/**
 * What the change check answered: the times the user's own data and the data everyone shares last
 * changed, the token that moves with the calculation date, and the release the server runs
 */
export type CheckAnswer = {
  personalChangedAt: string | null
  sharedChangedAt: string | null
  calculationDateToken: string
  serverVersion: string
}

/**
 * Everything this browser last saw of the changes, kept in the saved entry
 *
 * `observedAt` is when a check last found a difference, or when the record was first made. A covered
 * answer fetched at or after it is current as long as every later check matches `answer`, and the
 * 30 days a restored answer may stay unfetched count from it. `ratesDigest` is the latest answer of the
 * exchange-rate check, null while none is known
 */
export type CheckRecord = {
  answer: CheckAnswer
  observedAt: number
  ratesDigest: string | null
}

/** What the saved entry holds of a record in its encrypted copy. The entry's plain header holds `observedAt` */
export type SavedCheck = Pick<CheckRecord, 'answer' | 'ratesDigest'>

let record: CheckRecord | null = null
const recordListeners = new Set<() => void>()

/** The record this tab holds, or null before a check has answered or a copy with one was restored */
export function getCheckRecord() {
  return record
}

/**
 * Replaces the record and tells the listeners, so the saved entry is written again. A restore passes
 * `notify: false`, since the entry it restored already holds the record
 */
export function setCheckRecord(next: CheckRecord | null, { notify = true } = {}) {
  record = next
  if (notify) recordListeners.forEach((listener) => listener())
}

/** Calls `listener` whenever the record changes, and returns a function that stops that */
export function subscribeToCheckRecord(listener: () => void) {
  recordListeners.add(listener)
  return () => {
    recordListeners.delete(listener)
  }
}

function toUtcTimestamp(value: string | null) {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : value
}

/**
 * Takes from the server's answer what the comparison uses: the user's own change time, the shared
 * change time, the calculation date token and the server version
 *
 * Group markers are not compared. A grouped resource is not reachable (product rule), so a change
 * to one can't show in anything this browser holds, and the change times of both sides are read as
 * the same instant whatever offset the server wrote
 */
export function toCheckAnswer(status: CacheStatus): CheckAnswer {
  return {
    personalChangedAt: toUtcTimestamp(status.personal.changed_at),
    sharedChangedAt: toUtcTimestamp(status.shared_changed_at),
    calculationDateToken: status.calculation_date_token,
    serverVersion: status.server_version,
  }
}

export function isSameAnswer(a: CheckAnswer, b: CheckAnswer) {
  return (
    a.personalChangedAt === b.personalChangedAt &&
    a.sharedChangedAt === b.sharedChangedAt &&
    a.calculationDateToken === b.calculationDateToken &&
    a.serverVersion === b.serverVersion
  )
}

/**
 * Whether the last difference was found 30 days ago or longer, so every answer is fetched again. A
 * time ahead of the clock counts as due too, since a clock set back would otherwise stretch the 30 days
 */
export function isFullFetchDue(observedAt: number, now: number) {
  const age = now - observedAt
  return age < 0 || age >= FULL_FETCH_MAX_AGE_MS
}

/**
 * Whether the calculation date token moved and nothing else the check compares did. A new local day
 * alone looks like this
 */
function isNewDayOnly(known: CheckAnswer, answer: CheckAnswer) {
  return (
    known.calculationDateToken !== answer.calculationDateToken &&
    isSameAnswer(known, { ...answer, calculationDateToken: known.calculationDateToken })
  )
}

/**
 * Makes the covered answers fetched at or after `observedAt` current as of `now`, and marks the older
 * ones stale so they are fetched when a screen needs them, however recent their fetch time looks. An
 * answer already invalidated stays stale, so the date-dependent ones a new day invalidated keep that
 */
function stampCoveredAnswers(queryClient: QueryClient, observedAt: number, now: number) {
  for (const query of queryClient.getQueryCache().findAll({ predicate: isCoveredQuery })) {
    if (query.state.dataUpdatedAt >= observedAt) query.setState({ dataUpdatedAt: now })
    else query.invalidate()
  }
}

/**
 * Takes a check's answer: invalidates the app's data when it differs from the record or the full
 * fetch is due, and records it. The first answer of a tab with no record counts as a difference, so
 * what was fetched while it waited is fetched again once
 *
 * A new day alone, with the full fetch not due, invalidates only the covered answers that depend on
 * the current date. The record keeps its `observedAt`, since nothing the check watches changed, and
 * answers outside the covered list are left to their own stale time
 *
 * On opening, restored answers a difference didn't reach are made current: a covered one fetched at
 * or after the record's `observedAt` counts as fetched now, and an older one is marked stale so it
 * is fetched when a screen needs it, however recent its fetch time looks
 *
 * @param isOpening - Whether this is the check made as the app opens, with the restored answers not yet shown
 * @returns Whether the answer differs from the record's, so that the profile is fetched again too. A
 * new day alone doesn't
 */
export function applyCheckAnswer(queryClient: QueryClient, answer: CheckAnswer, now: number, isOpening: boolean) {
  const known = record
  if (known === null) {
    setCheckRecord({ answer, observedAt: now, ratesDigest: null })
    invalidateAppData(queryClient)
    return { changed: false }
  }

  const isDue = isFullFetchDue(known.observedAt, now)
  if (!isDue && isNewDayOnly(known.answer, answer)) {
    setCheckRecord({ ...known, answer })
    queryClient.invalidateQueries({ predicate: isDateDependentQuery, refetchType: 'active' })
    if (isOpening) stampCoveredAnswers(queryClient, known.observedAt, now)
    return { changed: false }
  }

  const changed = !isSameAnswer(known.answer, answer)
  if (changed || isDue) {
    setCheckRecord({ answer, observedAt: now, ratesDigest: known.ratesDigest })
    invalidateAppData(queryClient)
    return { changed }
  }

  if (isOpening) stampCoveredAnswers(queryClient, known.observedAt, now)
  return { changed: false }
}

/**
 * Takes the exchange-rate check's answer: a digest that is null or differs from the record's
 * invalidates what converts currencies
 *
 * Null means the rates can't be read now. That counts as changed every time, since nothing says
 * they stayed the same
 */
export function applyRatesDigest(queryClient: QueryClient, digest: string | null) {
  const known = record
  if (known === null) return
  if (digest !== null && digest === known.ratesDigest) return

  invalidateFxData(queryClient)
  if (digest !== known.ratesDigest) setCheckRecord({ ...known, ratesDigest: digest })
}
