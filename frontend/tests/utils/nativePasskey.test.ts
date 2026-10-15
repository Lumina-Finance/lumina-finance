/**
 * Tests the reply the native passkey page sends the app, whose keys and messages the app reads to
 * decide between a silent dismissal and the web's message for the flow
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}))

import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser'
import { runNativePasskeyCeremony } from '@/utils/nativePasskey'

/**
 * Builds the wrapped error the library raises for a given failure code
 */
function buildWebAuthnError(code: ConstructorParameters<typeof WebAuthnError>[0]['code'], causeName: string) {
  const cause = new Error('raw browser text')
  cause.name = causeName
  return new WebAuthnError({ message: 'raw browser text', code, cause })
}

describe('runNativePasskeyCeremony', () => {
  it('flags a sign-in prompt the user closed in Safari as dismissed', async () => {
    vi.mocked(startAuthentication).mockRejectedValue(buildWebAuthnError('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', 'NotAllowedError'))
    expect(await runNativePasskeyCeremony('get', '{}')).toEqual({
      error: 'Could not sign in with a passkey. Try again, or use your email and password.',
      cancelled: 'true',
    })
  })

  it('gives a failed passkey setup the setup message, not flagged as dismissed', async () => {
    vi.mocked(startRegistration).mockRejectedValue(
      buildWebAuthnError('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', 'InvalidStateError'),
    )
    expect(await runNativePasskeyCeremony('create', '{}')).toEqual({
      error: 'This device already has a passkey for your account.',
    })
  })
})
