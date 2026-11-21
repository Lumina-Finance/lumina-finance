/**
 * Runs a page of one build against a server of another through the change check, as a server updated
 * while the page is open does, and reads what the page then tells the user
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckRecord } from '@/api/cache/cacheCheck'

const { authenticatedFetchMock } = vi.hoisted(() => ({ authenticatedFetchMock: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  authenticatedFetch: authenticatedFetchMock,
}))

function statusOf(serverVersion: string) {
  return {
    changed_at: null,
    current_date: '2026-11-20',
    calculation_date_token: 'token-1',
    next_calculation_boundary_at: '2026-11-21T05:00:00Z',
    personal: { changed_at: '2026-11-01T00:00:00Z', last_change_from_current_session: false },
    groups: {},
    shared_changed_at: null,
    server_version: serverVersion,
  }
}

/**
 * Loads the app as a build of `pageVersion`, since a build's version is read as the modules load, and
 * has it ask the change check of a server running `serverVersion`. Returns what that page now tells
 * the user. The saved record of an earlier load holds `savedVersion`, the server's answer of then,
 * and the server answers by `answer`, or fails to when it is null
 */
async function openPage(
  pageVersion: string,
  serverVersion: string,
  { savedVersion = serverVersion, answers = true }: { savedVersion?: string; answers?: boolean } = {},
) {
  vi.stubEnv('VITE_APP_VERSION', pageVersion)
  vi.resetModules()
  const { setCheckRecord } = await import('@/api/cache/cacheCheck')
  const { runOpeningCacheCheck } = await import('@/hooks/useCacheValidation')
  const { getServerNotice } = await import('@/api/version')

  const record: CheckRecord = {
    answer: {
      personalChangedAt: '2026-11-01T00:00:00.000Z',
      sharedChangedAt: null,
      calculationDateToken: 'token-1',
      serverVersion: savedVersion,
    },
    observedAt: Date.now(),
    ratesDigest: null,
  }
  setCheckRecord(record, { notify: false })
  if (answers) authenticatedFetchMock.mockResolvedValue(statusOf(serverVersion))
  else authenticatedFetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
  await runOpeningCacheCheck(new QueryClient(), 'user-a')
  return getServerNotice()
}

afterEach(() => {
  vi.unstubAllEnvs()
  authenticatedFetchMock.mockReset()
})

describe('a page and a server of different versions', () => {
  it('has the old page offer a reload once the server is updated', async () => {
    await expect(openPage('0.14.0', '0.15.0')).resolves.toBe('update')
  })

  it('shows nothing when the page and the server run the same version', async () => {
    await expect(openPage('0.15.0', '0.15.0')).resolves.toBeNull()
  })

  it('takes nothing from the version an earlier load saved while the first check is unanswered', async () => {
    // The page was reloaded onto 0.15.0 after the saved record was written against a 0.14.0 server
    await expect(openPage('0.15.0', '0.15.0', { savedVersion: '0.14.0', answers: false })).resolves.toBeNull()
  })

  it.each([
    ['a server that reports no version', '0.14.0', ''],
    ['a page built with no version', '', '0.15.0'],
  ])("shows nothing for %s, which can't be told to be behind", async (_label, pageVersion, serverVersion) => {
    await expect(openPage(pageVersion, serverVersion)).resolves.toBeNull()
  })
})
