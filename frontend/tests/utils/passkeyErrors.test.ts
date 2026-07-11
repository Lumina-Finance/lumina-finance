/**
 * Tests the passkey registration error mapping so the common prompt outcomes keep reading as clear
 * guidance instead of raw browser or library text
 */
import { describe, expect, it } from 'vitest'

import { WebAuthnError } from '@simplewebauthn/browser'
import { getPasskeyRegistrationMessage, isPasskeyCeremonyCancelled } from '@/utils/passkeyErrors'

/**
 * Builds the wrapped error the library raises for a given failure code
 */
function buildWebAuthnError(code: ConstructorParameters<typeof WebAuthnError>[0]['code'], causeName: string) {
  const cause = new Error('raw browser text')
  cause.name = causeName
  return new WebAuthnError({ message: 'raw browser text', code, cause })
}

describe('getPasskeyRegistrationMessage', () => {
  it('explains a declined or timed-out prompt instead of passing the browser text through', () => {
    const error = buildWebAuthnError('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', 'NotAllowedError')
    expect(getPasskeyRegistrationMessage(error)).toBe(
      'The passkey prompt was declined or timed out, so no passkey was added. Try again to set one up.',
    )
  })

  it('explains an aborted ceremony', () => {
    const error = buildWebAuthnError('ERROR_CEREMONY_ABORTED', 'AbortError')
    expect(getPasskeyRegistrationMessage(error)).toBe('Passkey setup was cancelled or timed out.')
  })

  it('explains an authenticator that already holds a passkey', () => {
    const error = buildWebAuthnError('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', 'InvalidStateError')
    expect(getPasskeyRegistrationMessage(error)).toBe('This device already has a passkey for your account.')
  })

  it('falls back to the thrown message for other errors', () => {
    expect(getPasskeyRegistrationMessage(new Error('server refused the attestation'))).toBe(
      'server refused the attestation',
    )
  })

  it('falls back to a generic message when there is nothing to show', () => {
    expect(getPasskeyRegistrationMessage(undefined)).toBe('Could not add this passkey.')
  })
})

describe('isPasskeyCeremonyCancelled', () => {
  it('treats only an aborted ceremony as a silent cancel', () => {
    expect(isPasskeyCeremonyCancelled(buildWebAuthnError('ERROR_CEREMONY_ABORTED', 'AbortError'))).toBe(true)
    expect(isPasskeyCeremonyCancelled(buildWebAuthnError('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', 'NotAllowedError'))).toBe(
      false,
    )
  })
})
