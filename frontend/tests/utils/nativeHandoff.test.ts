/**
 * Tests that a browser blocking site data leaves the sign-in page working as it does for a person
 * who was not sent by a native app
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handOffToNativeApp, isNativeSignIn, rememberNativeChallenge } from '@/utils/nativeHandoff'

const CHALLENGE = 'A'.repeat(43)

/** Vitest runs without a DOM, so the window is a stand-in whose session storage is a map */
function stubWindow(sessionStorage: object) {
  vi.stubGlobal('window', { sessionStorage })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('native hand-off with session storage blocked', () => {
  it('neither throws nor hands off', () => {
    const blocked = {}
    Object.defineProperty(blocked, 'sessionStorage', {
      get: () => {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    vi.stubGlobal('window', blocked)

    expect(() => rememberNativeChallenge(`?native_challenge=${CHALLENGE}`)).not.toThrow()
    expect(isNativeSignIn()).toBe(false)
    expect(handOffToNativeApp('access-token')).toBe(false)
  })
})

describe('native hand-off with session storage available', () => {
  const items = new Map<string, string>()
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }

  afterEach(() => items.clear())

  it('remembers the challenge the app opened the page with', () => {
    stubWindow(storage)
    rememberNativeChallenge(`?native_challenge=${CHALLENGE}`)

    expect(isNativeSignIn()).toBe(true)
  })

  it('ignores a challenge that is not a SHA-256 digest', () => {
    stubWindow(storage)
    rememberNativeChallenge('?native_challenge=short')

    expect(isNativeSignIn()).toBe(false)
  })
})
