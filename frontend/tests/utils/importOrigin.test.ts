/**
 * Verifies the importer leads back to the page that opened it, its address filters included, and that a malformed
 * or off-site origin is read as no origin at all
 */
import { describe, expect, it } from 'vitest'
import { buildImportOriginState, readImportOrigin } from '@/utils/importOrigin'

describe('import origin', () => {
  it('reads back the page including its filters', () => {
    const state = buildImportOriginState({ pathname: '/transactions', search: '?category=abc' })

    expect(readImportOrigin(state)).toBe('/transactions?category=abc')
  })

  it.each([null, undefined, {}, { importOrigin: 4 }, { importOrigin: 'transactions' }, { importOrigin: '//other.example' }])(
    'reads %j as no origin',
    (state) => {
      expect(readImportOrigin(state)).toBeNull()
    },
  )

  // Browsers read a backslash in an address as a slash and drop tabs and line breaks, so these lead to
  // another site as "//" does
  it.each(['/\\other.example', '/\t/other.example', '/\n/other.example'])('reads the address %j as no origin', (importOrigin) => {
    expect(readImportOrigin({ importOrigin })).toBeNull()
  })
})
