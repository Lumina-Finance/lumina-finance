/**
 * Covers app version API request functions used by update notices
 *
 * These tests catch regressions where version checks stop bypassing browser cache
 * or backend release URL fields are not mapped for the frontend, and where a new build shows the
 * version answer an older build saved in the browser
 */
import { dehydrate, hydrate, QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@/api/config'
import { fetchAppVersion } from '@/api/version'
import { answerNever } from './fixtures'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('version API functions', () => {
  it('requests app version metadata without browser caching', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        version: '1.2.3',
        update: {
          version: '1.2.4',
          release_url: 'https://example.com/releases/1.2.4',
        },
      }),
    })

    await expect(fetchAppVersion()).resolves.toEqual({
      version: '1.2.3',
      update: {
        version: '1.2.4',
        releaseUrl: 'https://example.com/releases/1.2.4',
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/version`, {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    })
  })

  it('raises an error when version metadata fails to load', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))

    await expect(fetchAppVersion()).rejects.toMatchObject({
      message: 'Oops, something went wrong. Please try again.',
      status: 503,
    })
  })
})

describe('a version check the page no longer needs', () => {
  it('stops when the load that asked for it is abandoned', async () => {
    fetchMock.mockImplementationOnce(answerNever)
    const load = new AbortController()

    const request = fetchAppVersion(undefined, load.signal)
    load.abort(new DOMException('Left the page', 'AbortError'))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})

/**
 * Loads the version check's cache key afresh as a frontend build of the given version, since the
 * build version is read as the module loads
 */
async function loadBuild(version: string) {
  vi.stubEnv('VITE_APP_VERSION', version)
  vi.resetModules()
  const { appVersionKeys } = await import('@/api/cache/queryKeys')
  return appVersionKeys
}

/** Saves a version answer as a page of one build does, and restores it into a page of another */
async function restoreAcrossBuilds(savedBy: string, loadedBy: string) {
  const saving = new QueryClient()
  saving.setQueryData((await loadBuild(savedBy)).version(), {
    version: '0.14.0',
    update: { version: '0.15.0', releaseUrl: 'https://example.com/releases/0.15.0' },
  })
  const saved = JSON.parse(JSON.stringify(dehydrate(saving)))

  const loading = new QueryClient()
  hydrate(loading, saved)
  return loading.getQueryData((await loadBuild(loadedBy)).version())
}

describe('a version answer saved in the browser', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is left out once a newer build loads, so the new build asks the server again', async () => {
    await expect(restoreAcrossBuilds('0.14.0', '0.15.0')).resolves.toBeUndefined()
  })

  it('is reused by the build that saved it', async () => {
    await expect(restoreAcrossBuilds('0.14.0', '0.14.0')).resolves.toMatchObject({ version: '0.14.0' })
  })
})
