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

/**
 * Runs a test on arm64 as well as on amd64, where every other test runs only on amd64
 *
 * The whole suite runs on amd64, and on arm64 only the tests with this tag run, at desktop. Nothing
 * runs the whole suite on arm64. Few tests carry the tag, one existing test for
 * each part of the app that is compiled for the processor type. The parts come from the runtime
 * dependencies in `backend/uv.lock` that ship compiled wheels and from the binaries `docker/Dockerfile`
 * adds. A part is the work such a package or binary does for the app, such as the database driver, and
 * its test is one that fails when that work does not run. No test is written only to carry the tag, and
 * each spec names the part above its tag. A new compiled dependency or binary takes the tag on one test
 * for its part, unless a tagged test already covers it. The pull request workflow selects the tag by
 * name in `.github/workflows/_e2e-test.yml`
 */
export const ON_ARM64 = { tag: '@arm64' }
