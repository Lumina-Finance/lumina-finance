/**
 * Tests which failures of a setup's final step mean starting the setup again, and what the others say
 *
 * Every failure once did, so a dropped connection threw away a setup the server still held
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildApiError, MAINTENANCE_MESSAGE } from '@/api/auth'
import { explainRequestFailure, SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { reportMaintenance } from '@/api/version'
import { getSetupRetryMessage, isSetupRefused } from '@/utils/setupFailure'

describe('reading a failed final setup step', () => {
  it('starts again when the server refuses the step', () => {
    expect(isSetupRefused(buildApiError(400, { detail: 'Confirm an authenticator code first' }))).toBe(true)
    expect(isSetupRefused(buildApiError(404, null))).toBe(true)
  })

  it('keeps the step for another try when the request got no usable answer', () => {
    expect(isSetupRefused(new TypeError('Failed to fetch'))).toBe(false)
    expect(isSetupRefused(new DOMException('The server took too long', 'TimeoutError'))).toBe(false)
    expect(isSetupRefused(buildApiError(500, null))).toBe(false)
    expect(isSetupRefused(buildApiError(503, null))).toBe(false)
  })

  it('keeps the step for another try when there were too many requests', () => {
    expect(isSetupRefused(buildApiError(429, { detail: 'Too many requests' }))).toBe(false)
  })
})

// Authenticator, passkey and recovery code setups once said the server couldn't be reached during a
// maintenance
describe('the message a failed final setup step shows for another try', () => {
  afterEach(() => {
    reportMaintenance(false)
  })

  it('says the server is in maintenance when its answer carries the marker', () => {
    expect(getSetupRetryMessage(buildApiError(503, { maintenance: true }))).toBe(MAINTENANCE_MESSAGE)
  })

  it('says the server is in maintenance for a lost connection once the maintenance file reports one', () => {
    const lost = explainRequestFailure(new TypeError('Failed to fetch'))
    expect(getSetupRetryMessage(lost)).toBe(SERVER_UNREACHABLE_MESSAGE)

    reportMaintenance(true)

    expect(getSetupRetryMessage(lost)).toBe(MAINTENANCE_MESSAGE)
  })

  it('says the server could not be reached for a server error during a maintenance', () => {
    reportMaintenance(true)

    expect(getSetupRetryMessage(buildApiError(500, { detail: 'Internal error' }))).toBe(SERVER_UNREACHABLE_MESSAGE)
  })
})
