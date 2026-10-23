/**
 * Tests which failures of a setup's final step mean starting the setup again
 *
 * Every failure once did, so a dropped connection threw away a setup the server still held
 */
import { describe, expect, it } from 'vitest'
import { buildApiError } from '@/api/auth'
import { isSetupRefused } from '@/utils/setupFailure'

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
