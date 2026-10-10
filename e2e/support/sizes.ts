/**
 * Runs a test in the tablet and phone projects as well as on desktop
 *
 * Taken only by a test whose result depends on the screen's width or on touch input, such as a layout
 * that changes at a breakpoint or an action reached by tap. Every other test runs on desktop alone,
 * since it would fail the same way at every size. Each spec states at its top which it is and why
 */
export const AT_EVERY_SIZE = { tag: '@every-size' }

/** Selects the tests tagged with `AT_EVERY_SIZE`, for the projects that run only those */
export const EVERY_SIZE_TESTS = new RegExp(AT_EVERY_SIZE.tag)
