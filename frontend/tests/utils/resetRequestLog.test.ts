import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordResetRequest, recordSignupRequest } from '@/utils/resetRequestLog'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Builds a minimal localStorage stand-in backed by a plain object
 */
function createStorageMock() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
  }
}

describe('recordResetRequest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('counts requests within the rolling day', () => {
    vi.stubGlobal('window', { localStorage: createStorageMock() })

    expect(recordResetRequest(1_000)).toBe(1)
    expect(recordResetRequest(2_000)).toBe(2)
    expect(recordResetRequest(3_000)).toBe(3)
  })

  it('drops requests older than the rolling day', () => {
    vi.stubGlobal('window', { localStorage: createStorageMock() })

    expect(recordResetRequest(1_000)).toBe(1)
    expect(recordResetRequest(1_000 + DAY_MS + 1)).toBe(1)
  })

  it('counts sign-up requests apart from reset requests', () => {
    vi.stubGlobal('window', { localStorage: createStorageMock() })

    expect(recordResetRequest(1_000)).toBe(1)
    expect(recordSignupRequest(2_000)).toBe(1)
    expect(recordSignupRequest(3_000)).toBe(2)
  })

  it('reports a first request when storage is unavailable', () => {
    vi.stubGlobal('window', undefined)

    expect(recordResetRequest()).toBe(1)
  })

  // A browser blocking site data throws as soon as the store is touched, which once broke the
  // forgot-password confirmation
  it('reports a first request when the browser blocks storage', () => {
    const blocked = {}
    Object.defineProperty(blocked, 'localStorage', {
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    vi.stubGlobal('window', blocked)

    expect(recordResetRequest(1_000)).toBe(1)
  })

  it('recovers from corrupted stored state', () => {
    const storage = createStorageMock()
    storage.setItem('lumina:reset_request_log', 'not-json')
    vi.stubGlobal('window', { localStorage: storage })

    expect(recordResetRequest(1_000)).toBe(1)
  })
})
