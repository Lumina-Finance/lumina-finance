/**
 * Tests the flag that survives a signed-in trip out to a provider when the browser blocks storage
 *
 * Reading it once threw while the callback page rendered, which broke every provider return there
 */
import { afterEach, expect, it, vi } from 'vitest'
import { consumeOidcIntent, markOidcIntent } from '@/utils/oidcIntent'

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
  expect(consumeOidcIntent()).toBeNull()
})

it('says the flag could not be kept when the browser blocks storage', () => {
  blockStorage()
  expect(markOidcIntent({ flow: 'reauth', action: { kind: 'set-password' } })).toBe(false)
})
