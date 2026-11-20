/**
 * Guards what the change check decides: which answers count as a difference, that restored answers a
 * check found nothing different for are current only when fetched since the check last found one and
 * within 30 days of it, that a new day alone refetches only the date-dependent answers, and that the
 * exchange-rate digest invalidates what converts currencies
 */
import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyCheckAnswer,
  applyRatesDigest,
  FULL_FETCH_MAX_AGE_MS,
  getCheckRecord,
  setCheckRecord,
  toCheckAnswer,
  type CheckAnswer,
  type CheckRecord,
} from '@/api/cache/cacheCheck'
import type { CacheStatus } from '@/api/user'

const DAY_MS = 24 * 60 * 60 * 1000
const OBSERVED_AT = Date.parse('2026-10-01T12:00:00Z')

const ANSWER: CheckAnswer = {
  personalChangedAt: '2026-09-30T08:00:00.000Z',
  sharedChangedAt: '2026-09-01T00:00:00.000Z',
  calculationDateToken: 'token-1',
  serverVersion: '1.0.0',
}

const STATUS: CacheStatus = {
  changed_at: '2026-09-30T08:00:00Z',
  current_date: '2026-10-01',
  calculation_date_token: 'token-1',
  next_calculation_boundary_at: '2026-10-02T04:00:00Z',
  personal: { changed_at: '2026-09-30T08:00:00Z', last_change_from_current_session: false },
  groups: {},
  shared_changed_at: '2026-09-01T00:00:00Z',
  server_version: '1.0.0',
}

const RECORD: CheckRecord = { answer: ANSWER, observedAt: OBSERVED_AT, ratesDigest: 'digest-1' }

const clients: QueryClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) client.clear()
  setCheckRecord(null, { notify: false })
})

/** A query cache holding one answer per key, each fetched at the time given */
function cacheOf(fetchedAt: Record<string, { key: unknown[]; at: number }>) {
  const client = new QueryClient()
  clients.push(client)
  for (const [name, { key, at }] of Object.entries(fetchedAt)) client.setQueryData(key, name, { updatedAt: at })
  return client
}

const stateOf = (client: QueryClient, key: unknown[]) =>
  client.getQueryCache().find({ queryKey: key, exact: true })!.state

describe('which answers differ', () => {
  it('reads the two change times as instants, whatever offset the server writes, and leaves groups out', () => {
    const answer = toCheckAnswer({
      ...STATUS,
      personal: { changed_at: '2026-09-30T10:00:00+02:00', last_change_from_current_session: true },
      shared_changed_at: null,
      groups: { 'group-1': { changed_at: '2026-10-01T00:00:00Z', last_change_from_current_session: false } },
    })

    expect(answer).toEqual({ ...ANSWER, sharedChangedAt: null })
    expect(Object.keys(answer)).not.toContain('groups')
  })

  it.each([
    ['personal change time', { personalChangedAt: '2026-09-30T08:00:01.000Z' }],
    ['shared change time', { sharedChangedAt: null }],
    ['calculation date together with the server version', { calculationDateToken: 'token-2', serverVersion: '1.0.1' }],
    ['server version', { serverVersion: '1.0.1' }],
  ])('invalidates the app data when only the %s differs, and records the answer as seen now', (_name, change) => {
    setCheckRecord(RECORD, { notify: false })
    const client = cacheOf({ accounts: { key: ['accounts'], at: OBSERVED_AT + 1 } })
    const now = OBSERVED_AT + DAY_MS

    const { changed } = applyCheckAnswer(client, { ...ANSWER, ...change }, now, false)

    expect(changed).toBe(true)
    expect(stateOf(client, ['accounts']).isInvalidated).toBe(true)
    expect(getCheckRecord()).toEqual({ answer: { ...ANSWER, ...change }, observedAt: now, ratesDigest: 'digest-1' })
  })

  it('changes nothing while the answer matches and fewer than 30 days have passed, and keeps the time', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = cacheOf({ accounts: { key: ['accounts'], at: OBSERVED_AT + 1 } })

    const { changed } = applyCheckAnswer(client, ANSWER, OBSERVED_AT + DAY_MS, false)

    expect(changed).toBe(false)
    expect(stateOf(client, ['accounts']).isInvalidated).toBe(false)
    expect(getCheckRecord()).toBe(RECORD)
  })

  it('counts the first answer of a tab with no record as a difference, so earlier fetches are made again once', () => {
    const client = cacheOf({ accounts: { key: ['accounts'], at: OBSERVED_AT - 1 } })

    applyCheckAnswer(client, ANSWER, OBSERVED_AT, false)

    expect(stateOf(client, ['accounts']).isInvalidated).toBe(true)
    expect(getCheckRecord()).toEqual({ answer: ANSWER, observedAt: OBSERVED_AT, ratesDigest: null })
  })
})

describe('a new day', () => {
  const NEW_DAY: CheckAnswer = { ...ANSWER, calculationDateToken: 'token-2' }

  // One answer from a date-dependent family and one from a family that isn't, both fetched since the record
  const dayCache = () =>
    cacheOf({
      balances: { key: ['accounts'], at: OBSERVED_AT + 1 },
      transactions: { key: ['transactions', 'list', {}], at: OBSERVED_AT + 1 },
      lastImport: { key: ['last-import'], at: OBSERVED_AT + 1 },
    })

  it('invalidates only the answers that depend on the date, keeps the record time, and does not ask for the profile', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = dayCache()

    const { changed } = applyCheckAnswer(client, NEW_DAY, OBSERVED_AT + DAY_MS, false)

    expect(changed).toBe(false)
    expect(stateOf(client, ['accounts']).isInvalidated).toBe(true)
    expect(stateOf(client, ['transactions', 'list', {}]).isInvalidated).toBe(false)
    expect(stateOf(client, ['last-import']).isInvalidated).toBe(false)
    expect(getCheckRecord()).toEqual({ ...RECORD, answer: NEW_DAY })
  })

  it('on opening also keeps the other covered answers current, and a reopen the same day fetches nothing more', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = dayCache()
    const now = OBSERVED_AT + DAY_MS

    applyCheckAnswer(client, NEW_DAY, now, true)
    applyCheckAnswer(client, NEW_DAY, now + 1000, true)

    expect(stateOf(client, ['accounts']).isInvalidated).toBe(true)
    expect(stateOf(client, ['transactions', 'list', {}])).toMatchObject({
      isInvalidated: false,
      dataUpdatedAt: now + 1000,
    })
  })

  it.each([
    ['personal change time', { personalChangedAt: '2026-10-02T00:00:00.000Z' }],
    ['shared change time', { sharedChangedAt: '2026-10-02T00:00:00.000Z' }],
    ['server version', { serverVersion: '1.0.1' }],
  ])('invalidates everything when the %s changes with it, as before', (_name, change) => {
    setCheckRecord(RECORD, { notify: false })
    const client = dayCache()
    const now = OBSERVED_AT + DAY_MS
    const answer = { ...NEW_DAY, ...change }

    const { changed } = applyCheckAnswer(client, answer, now, false)

    expect(changed).toBe(true)
    expect(stateOf(client, ['transactions', 'list', {}]).isInvalidated).toBe(true)
    expect(stateOf(client, ['last-import']).isInvalidated).toBe(true)
    expect(getCheckRecord()).toEqual({ ...RECORD, answer, observedAt: now })
  })

  it('invalidates everything once the 30 days are up, and one millisecond short of them only the dated answers', () => {
    for (const [age, isEverythingFetched] of [
      [FULL_FETCH_MAX_AGE_MS - 1, false],
      [FULL_FETCH_MAX_AGE_MS, true],
    ] as const) {
      setCheckRecord(RECORD, { notify: false })
      const client = dayCache()

      applyCheckAnswer(client, NEW_DAY, OBSERVED_AT + age, false)

      expect(stateOf(client, ['accounts']).isInvalidated).toBe(true)
      expect(stateOf(client, ['transactions', 'list', {}]).isInvalidated, `after ${age} ms`).toBe(isEverythingFetched)
    }
  })
})

describe('the 30 days a restored answer may go unfetched', () => {
  it('treats an unchanged answer as current one millisecond short of 30 days, and fetches again at 30 days', () => {
    expect(FULL_FETCH_MAX_AGE_MS).toBe(30 * DAY_MS)
    for (const [age, isFetchedAgain] of [
      [FULL_FETCH_MAX_AGE_MS - 1, false],
      [FULL_FETCH_MAX_AGE_MS, true],
      [FULL_FETCH_MAX_AGE_MS + 1, true],
    ] as const) {
      setCheckRecord(RECORD, { notify: false })
      const client = cacheOf({ accounts: { key: ['accounts'], at: OBSERVED_AT + 5 } })
      const now = OBSERVED_AT + age

      applyCheckAnswer(client, ANSWER, now, true)

      expect(stateOf(client, ['accounts']).isInvalidated, `after ${age} ms`).toBe(isFetchedAgain)
      expect(getCheckRecord()?.observedAt, `after ${age} ms`).toBe(isFetchedAgain ? now : OBSERVED_AT)
    }
  })
})

describe('a later check while the app stays open', () => {
  it('fetches everything again once the last difference is 30 days old, and when the clock was set back past it', () => {
    for (const [age, isFetchedAgain] of [
      [FULL_FETCH_MAX_AGE_MS - 1, false],
      [FULL_FETCH_MAX_AGE_MS, true],
      [-1, true],
    ] as const) {
      setCheckRecord(RECORD, { notify: false })
      const client = cacheOf({ accounts: { key: ['accounts'], at: OBSERVED_AT + 5 } })

      applyCheckAnswer(client, ANSWER, OBSERVED_AT + age, false)

      expect(stateOf(client, ['accounts']).isInvalidated, `after ${age} ms`).toBe(isFetchedAgain)
    }
  })
})

describe('opening with a restored copy', () => {
  it('makes a covered answer fetched at or after the record current now, and one fetched before it stale', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = cacheOf({
      atTime: { key: ['accounts'], at: OBSERVED_AT },
      after: { key: ['transactions', 'list', {}], at: OBSERVED_AT + 1 },
      before: { key: ['budgets', 'periods'], at: OBSERVED_AT - 1 },
    })
    const now = OBSERVED_AT + 10 * DAY_MS

    applyCheckAnswer(client, ANSWER, now, true)

    expect(stateOf(client, ['accounts'])).toMatchObject({ dataUpdatedAt: now, isInvalidated: false })
    expect(stateOf(client, ['transactions', 'list', {}])).toMatchObject({ dataUpdatedAt: now, isInvalidated: false })
    expect(stateOf(client, ['budgets', 'periods'])).toMatchObject({
      dataUpdatedAt: OBSERVED_AT - 1,
      isInvalidated: true,
    })
  })

  it('leaves an answer the check does not cover as it was', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = cacheOf({
      lastImport: { key: ['last-import'], at: OBSERVED_AT + 1 },
      status: { key: ['bank-sync', 'account', 'account-1'], at: OBSERVED_AT - 1 },
    })

    applyCheckAnswer(client, ANSWER, OBSERVED_AT + DAY_MS, true)

    expect(stateOf(client, ['last-import'])).toMatchObject({ dataUpdatedAt: OBSERVED_AT + 1, isInvalidated: false })
    expect(stateOf(client, ['bank-sync', 'account', 'account-1'])).toMatchObject({
      dataUpdatedAt: OBSERVED_AT - 1,
      isInvalidated: false,
    })
  })

  it('stamps nothing on a later check while the app is open', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = cacheOf({ accounts: { key: ['accounts'], at: OBSERVED_AT + 1 } })

    applyCheckAnswer(client, ANSWER, OBSERVED_AT + DAY_MS, false)

    expect(stateOf(client, ['accounts']).dataUpdatedAt).toBe(OBSERVED_AT + 1)
  })

  it('invalidates the covered answers a difference reaches, and a later open finds none of them current', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = cacheOf({ inactive: { key: ['accounts'], at: OBSERVED_AT + 1 } })
    const now = OBSERVED_AT + DAY_MS

    applyCheckAnswer(client, { ...ANSWER, personalChangedAt: '2026-10-02T00:00:00.000Z' }, now, true)
    const record = getCheckRecord()!

    // The answer was never fetched again, so it is older than the record that now says what changed
    expect(stateOf(client, ['accounts']).dataUpdatedAt).toBeLessThan(record.observedAt)
  })
})

describe('the exchange-rate digest', () => {
  const fxCache = () =>
    cacheOf({
      budgets: { key: ['budgets', 'periods'], at: OBSERVED_AT + 1 },
      lastImport: { key: ['last-import'], at: OBSERVED_AT + 1 },
    })

  it('invalidates what converts currencies when the digest differs, and records it', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = fxCache()

    applyRatesDigest(client, 'digest-2')

    expect(stateOf(client, ['budgets', 'periods']).isInvalidated).toBe(true)
    expect(stateOf(client, ['last-import']).isInvalidated).toBe(false)
    expect(getCheckRecord()?.ratesDigest).toBe('digest-2')
  })

  it('leaves everything as it was when the digest matches', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = fxCache()

    applyRatesDigest(client, 'digest-1')

    expect(stateOf(client, ['budgets', 'periods']).isInvalidated).toBe(false)
    expect(getCheckRecord()).toBe(RECORD)
  })

  it('counts no digest as a change every time, even when none was known either', () => {
    setCheckRecord({ ...RECORD, ratesDigest: null }, { notify: false })
    const client = fxCache()

    applyRatesDigest(client, null)
    expect(stateOf(client, ['budgets', 'periods']).isInvalidated).toBe(true)

    client.setQueryData(['budgets', 'periods'], 'again', { updatedAt: OBSERVED_AT + 2 })
    applyRatesDigest(client, null)
    expect(stateOf(client, ['budgets', 'periods']).isInvalidated).toBe(true)
  })

  it('keeps an invalidated answer no screen shows invalidated through a save and a restore', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = fxCache()

    applyRatesDigest(client, 'digest-2')
    const restored = new QueryClient()
    clients.push(restored)
    hydrate(restored, JSON.parse(JSON.stringify(dehydrate(client))))

    expect(restored.getQueryState(['budgets', 'periods'])?.isInvalidated).toBe(true)
    expect(restored.getQueryState(['last-import'])?.isInvalidated).toBe(false)
  })

  it('takes a digest that is none against a known digest as a change, and leaves the record alone when both are none', () => {
    setCheckRecord(RECORD, { notify: false })
    const client = fxCache()

    applyRatesDigest(client, null)
    expect(stateOf(client, ['budgets', 'periods']).isInvalidated).toBe(true)
    expect(getCheckRecord()?.ratesDigest).toBeNull()

    const afterFirst = getCheckRecord()
    applyRatesDigest(client, null)
    expect(getCheckRecord()).toBe(afterFirst)
  })

  it('does nothing before a check has answered', () => {
    const client = fxCache()

    applyRatesDigest(client, 'digest-2')

    expect(stateOf(client, ['budgets', 'periods']).isInvalidated).toBe(false)
    expect(getCheckRecord()).toBeNull()
  })
})
