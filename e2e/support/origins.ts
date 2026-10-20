/**
 * Runs a test in the cross-origin project instead of on desktop
 *
 * Taken only by a test that needs the browser to load the app from one origin and reach the API at
 * another, such as one that reads a response header the API must list as exposed. The packaged image
 * serves both from one origin, so the project runs against a stack whose frontend was built with
 * another API address. Every other test stays out of it, since it would pass the same way anywhere
 */
export const ACROSS_ORIGINS = { tag: '@across-origins' }

/** Selects the tests tagged with `ACROSS_ORIGINS`, for the project that runs only those */
export const ACROSS_ORIGINS_TESTS = new RegExp(ACROSS_ORIGINS.tag)
