import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter'

/** What a test in a visual run may take, which the config sets as the run's test timeout */
export const VISUAL_TEST_TIMEOUT_MS = 120_000

// A test that times out at the limit still tears down its fixtures and saves its trace before it is
// reported, so the watchdog waits that long past the limit rather than fire on a test that is
// already failing at the limit
const TEARDOWN_ALLOWANCE_MS = 30_000

/**
 * Stops a visual run whose test outlives its limit, because a spec cannot be stopped from raising its own
 *
 * `test.setTimeout`, `test.slow` and `testInfo.setTimeout` all override the config's timeout from inside
 * the spec, and a spec copied in for a run is written by whoever is taking the screenshots. Refusing
 * the calls would mean patching Playwright's `test` object in every worker, and the config cannot cover
 * the call made inside a test body. A reporter runs in the runner, outside every spec, and sees only
 * how long each test has been going, which is what the limit is about. It interrupts the run, so the
 * wait ends and the run fails with the message below instead of burning the raised timeout
 */
export default class VisualLimitReporter implements Reporter {
  private readonly watchdogs = new Map<TestResult, NodeJS.Timeout>()
  private overran = false

  onTestBegin(test: TestCase, result: TestResult): void {
    const watchdog = setTimeout(() => {
      this.overran = true
      console.error(
        `\n${test.title} was still running after ${(VISUAL_TEST_TIMEOUT_MS + TEARDOWN_ALLOWANCE_MS) / 1000}s. ` +
          `A visual run allows ${VISUAL_TEST_TIMEOUT_MS / 1000}s per test and a spec cannot raise it, so remove the ` +
          'test.setTimeout, test.slow or testInfo.setTimeout call and make the test faster. Stopping the run\n',
      )
      process.kill(process.pid, 'SIGINT')
    }, VISUAL_TEST_TIMEOUT_MS + TEARDOWN_ALLOWANCE_MS)
    this.watchdogs.set(result, watchdog)
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    clearTimeout(this.watchdogs.get(result))
    this.watchdogs.delete(result)
  }

  async onEnd(): Promise<{ status: FullResult['status'] } | undefined> {
    return this.overran ? { status: 'failed' } : undefined
  }

  printsToStdio(): boolean {
    return false
  }
}
