/**
 * Runs before every test file, so property tests draw the same inputs on every run, where random
 * draws let a suite pass on one run and fail on the next with nothing changed
 */
import fc from 'fast-check'

// A failure in CI reproduces from its log under this seed. Change it locally to explore fresh inputs
const PROPERTY_SEED = 424242

fc.configureGlobal({ seed: PROPERTY_SEED })
