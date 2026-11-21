/**
 * Runs before every test file, so property tests draw the same inputs on every run, where random
 * draws let a suite pass on one run and fail on the next with nothing changed
 */
import fc from 'fast-check'
import { vi } from 'vitest'

// A request the server never answered has the page ask for the maintenance file, and that ask keeps a
// rate limit across tests. Left real, it would add a request to the first failing test of each file
// and none to the next, so counts of requests would depend on the order tests run in. The tests of the
// file itself unmock it
vi.mock('@/api/version/maintenanceFile', () => ({
  checkMaintenanceFile: () => Promise.resolve(),
}))

// A failure in CI reproduces from its log under this seed. Change it locally to explore fresh inputs
const PROPERTY_SEED = 424242

fc.configureGlobal({ seed: PROPERTY_SEED })
