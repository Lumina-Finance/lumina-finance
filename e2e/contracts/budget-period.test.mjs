import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// Match Playwright's extensionless TypeScript imports in the native Node contract runner
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './target' && context.parentURL?.endsWith('/support/api.ts')) {
      return nextResolve(new URL('./target.ts', context.parentURL).href, context)
    }
    return nextResolve(specifier, context)
  },
})
process.env.E2E_BASE_URL = 'http://fixture.example'
const { budgetPeriodStart } = await import('../support/api.ts')

test('completed budget periods handle January, leap years and the suite timezone', () => {
  for (const [instant, expected] of [
    ['2026-01-15T12:00:00Z', '2025-12-01'],
    ['2024-03-15T12:00:00Z', '2024-02-01'],
    ['2026-09-01T03:59:59Z', '2026-07-01'],
    ['2026-09-01T04:00:00Z', '2026-08-01'],
  ]) {
    assert.equal(budgetPeriodStart(new Date(instant)), expected, instant)
  }
})
