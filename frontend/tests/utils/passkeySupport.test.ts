/**
 * Tests the passkey support guard so the settings UI keeps blocking registration on origins where a
 * ceremony would fail, and keeps explaining how to reach a working one
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
}))

import { browserSupportsWebAuthn } from '@simplewebauthn/browser'
import { assessPasskeySupport } from '@/utils/passkeySupport'

/**
 * Points the guard at a chosen secure-context and hostname for one assessment
 */
function stubOrigin(isSecureContext: boolean, hostname: string) {
  vi.stubGlobal('window', { isSecureContext, location: { hostname } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
})

describe('assessPasskeySupport', () => {
  it('reports unconfigured when the server has no relying party id', () => {
    stubOrigin(true, 'example.com')
    expect(assessPasskeySupport('')).toMatchObject({ supported: false, reason: 'unconfigured' })
  })

  it('blocks an insecure context such as IP over HTTP', () => {
    stubOrigin(false, '192.0.2.10')
    expect(assessPasskeySupport('example.com')).toMatchObject({ supported: false, reason: 'insecure-context' })
  })

  it('blocks a browser without WebAuthn support', () => {
    stubOrigin(true, 'example.com')
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false)
    expect(assessPasskeySupport('example.com')).toMatchObject({ supported: false, reason: 'unsupported-browser' })
  })

  it('blocks a bare IP host even over HTTPS', () => {
    stubOrigin(true, '192.168.1.5')
    expect(assessPasskeySupport('example.com')).toMatchObject({ supported: false, reason: 'ip-host' })
  })

  it('blocks a hostname outside the relying party domain', () => {
    stubOrigin(true, 'evil.com')
    expect(assessPasskeySupport('example.com')).toMatchObject({ supported: false, reason: 'rp-mismatch' })
  })

  it('allows the exact relying party domain', () => {
    stubOrigin(true, 'example.com')
    expect(assessPasskeySupport('example.com')).toEqual({ supported: true })
  })

  it('allows a subdomain of the relying party domain', () => {
    stubOrigin(true, 'app.example.com')
    expect(assessPasskeySupport('example.com')).toEqual({ supported: true })
  })

  it('allows localhost during development', () => {
    stubOrigin(true, 'localhost')
    expect(assessPasskeySupport('localhost')).toEqual({ supported: true })
  })
})
