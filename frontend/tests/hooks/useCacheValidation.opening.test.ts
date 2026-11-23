/**
 * Guards the check made as the app opens with a restored saved copy: it asks the server once before
 * any screen shows, takes nothing else from it, and a failing check leaves the restored answers alone
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCheckRecord, setCheckRecord, type CheckRecord } from '@/api/cache/cacheCheck'
import { isNewObservation, runOpeningCacheCheck } from '@/hooks/useCacheValidation'

const { authenticatedFetchMock } = vi.hoisted(() => ({ authenticatedFetchMock: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  authenticatedFetch: authenticatedFetchMock,
}))

const NOW = Date.parse('2026-11-20T12:00:00Z')
const OBSERVED_AT = NOW - 3 * 24 * 60 * 60 * 1000

const STATUS = {
  changed_at: null,
  current_date: '2026-11-20',
  calculation_date_token: 'token-1',
  foreign_currencies_token: null,
  next_calculation_boundary_at: '2026-11-21T05:00:00Z',
  personal: { changed_at: '2026-11-01T00:00:00Z', last_change_from_current_session: false },
  groups: {},
  shared_changed_at: null,
  server_version: '1.0.0',
}

const RECORD: CheckRecord = {
  answer: {
    personalChangedAt: '2026-11-01T00:00:00.000Z',
    sharedChangedAt: null,
    calculationDateToken: 'token-1',
    foreignCurrenciesToken: null,
    serverVersion: '1.0.0',
  },
  observedAt: OBSERVED_AT,
  ratesDigest: null,
}

const client = new QueryClient()

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  client.setQueryData(['accounts'], [{ id: 'account-1' }], { updatedAt: OBSERVED_AT + 1 })
})

afterEach(() => {
  client.clear()
  setCheckRecord(null, { notify: false })
  authenticatedFetchMock.mockReset()
  vi.useRealTimers()
})

describe('the check made as the app opens', () => {
  it('asks the change check once, and nothing else, and counts the restored answers as fetched now', async () => {
    setCheckRecord(RECORD, { notify: false })
    authenticatedFetchMock.mockResolvedValue(STATUS)

    await runOpeningCacheCheck(client, 'user-a')

    expect(authenticatedFetchMock.mock.calls).toEqual([['/me/cache-status']])
    expect(client.getQueryState(['accounts'])).toMatchObject({ dataUpdatedAt: NOW, isInvalidated: false })
  })

  it('invalidates the restored answers when something changed', async () => {
    setCheckRecord(RECORD, { notify: false })
    authenticatedFetchMock.mockResolvedValue({
      ...STATUS,
      personal: { changed_at: '2026-11-19T00:00:00Z', last_change_from_current_session: false },
    })

    await runOpeningCacheCheck(client, 'user-a')

    expect(client.getQueryState(['accounts'])?.isInvalidated).toBe(true)
    expect(getCheckRecord()?.observedAt).toBe(NOW)
  })

  it('asks nothing when no record was restored, and leaves the first check to the hook', async () => {
    await runOpeningCacheCheck(client, 'user-a')

    expect(authenticatedFetchMock).not.toHaveBeenCalled()
  })

  it('settles without touching the restored answers when the check fails', async () => {
    setCheckRecord(RECORD, { notify: false })
    authenticatedFetchMock.mockRejectedValue(new Error('offline'))

    await expect(runOpeningCacheCheck(client, 'user-a')).resolves.toBeUndefined()

    expect(client.getQueryState(['accounts'])).toMatchObject({ dataUpdatedAt: OBSERVED_AT + 1, isInvalidated: false })
    expect(getCheckRecord()).toBe(RECORD)
  })
})

describe('a write of the saved entry by another tab', () => {
  const entry = (observedAt?: number) =>
    JSON.stringify({
      shape: '9',
      userId: 'user-a',
      keyNumber: 0,
      savedAt: 1,
      nonce: 'n',
      ciphertext: 'c',
      ...(observedAt === undefined ? {} : { observedAt }),
    })

  it('asks this tab to check when it records a time this tab has not seen', () => {
    expect(isNewObservation(entry(OBSERVED_AT + 5), [OBSERVED_AT, null])).toBe(true)
  })

  it('leaves it alone when it only saves more answers under a time this tab holds or was told of', () => {
    expect(isNewObservation(entry(OBSERVED_AT), [OBSERVED_AT])).toBe(false)
    expect(isNewObservation(entry(OBSERVED_AT + 5), [null, OBSERVED_AT + 5])).toBe(false)
  })

  it('leaves it alone when the entry is removed, unreadable or records no check yet', () => {
    expect(isNewObservation(null, [OBSERVED_AT])).toBe(false)
    expect(isNewObservation('not json', [OBSERVED_AT])).toBe(false)
    expect(isNewObservation(entry(), [OBSERVED_AT])).toBe(false)
  })
})
