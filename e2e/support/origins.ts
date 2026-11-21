/**
 * Runs a test only against a stack whose API answers at another origin than the app
 *
 * Taken only by a test that needs the browser to load the app from one origin and reach the API at
 * another, such as one that reads a response header the API must list as exposed. The packaged image
 * serves both from one origin, so a run against it leaves these out, and a run whose target has the
 * API elsewhere (`IS_API_ON_OTHER_ORIGIN`) includes them with every other test
 */
export const ACROSS_ORIGINS = { tag: '@across-origins' }

/** Selects the tests tagged with `ACROSS_ORIGINS` */
export const ACROSS_ORIGINS_TESTS = new RegExp(ACROSS_ORIGINS.tag)

/**
 * Keeps a test out of a run against a stack whose API answers at another origin than the app
 *
 * Taken by a test that asks the app's own address for what only the packaged image serves there, such
 * as a response header of its web server or the API beneath `/api`. A stack that serves the frontend
 * elsewhere answers that differently, so the test cannot judge it. Each use says why, and the reason is
 * shown beside the test in the report. Every other test runs in both modes, so one of these is the
 * exception that needs a reason, and a test that merely passes more slowly or less often does not
 *
 * @param reason - What the test relies on that a stack with the API elsewhere does not provide
 */
export function needsOneAddress(reason: string) {
  return { tag: '@one-address', annotation: { type: 'one-address', description: reason } }
}

/** Selects the tests marked with `needsOneAddress` */
export const ONE_ADDRESS_TESTS = /@one-address/
