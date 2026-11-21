/**
 * Tests the flag that survives a signed-in trip out to a provider when the browser blocks storage
 *
 * Reading it once threw while the callback page rendered and broke every provider return there. It also
 * guards the step each reauth action resumes, since the callback once treated any action it did not name
 * as an unlink
 */
import { afterEach, expect, it, vi } from 'vitest'
import { getReauthResumeState, markOidcIntent, readOidcIntent } from '@/utils/oidcIntent'

afterEach(() => {
  vi.unstubAllGlobals()
})

function blockStorage() {
  const blocked = {}
  Object.defineProperty(blocked, 'sessionStorage', {
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    },
  })
  vi.stubGlobal('window', blocked)
}

it('reads a provider return as having no flag when the browser blocks storage', () => {
  blockStorage()
  expect(readOidcIntent()).toBeNull()
})

it('says the flag could not be kept when the browser blocks storage', () => {
  blockStorage()
  expect(markOidcIntent({ flow: 'reauth', action: { kind: 'set-password' } })).toBe(false)
})

it('tells settings which action to finish after a reauth, one flag per action', () => {
  expect(getReauthResumeState({ kind: 'set-password' })).toEqual({ setPassword: true })
  expect(getReauthResumeState({ kind: 'link', slug: 'idp' })).toEqual({ resumeLink: 'idp' })
  expect(getReauthResumeState({ kind: 'unlink', identityId: 'identity-1' })).toEqual({ resumeUnlink: 'identity-1' })
  expect(getReauthResumeState({ kind: 'end-other-sessions' })).toEqual({ resumeEndOtherSessions: true })
  expect(getReauthResumeState({ kind: 'change-email', email: 'new@example.com' })).toEqual({
    resumeChangeEmail: 'new@example.com',
  })
})
