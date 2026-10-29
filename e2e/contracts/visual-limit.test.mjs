import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

const { default: VisualLimitReporter, VISUAL_TEST_TIMEOUT_MS } = await import('../support/visual-limit-reporter.ts')

const SPEC_TEST = { title: 'shows the new chart' }

function startTest(reporter) {
  const result = {}
  reporter.onTestBegin(SPEC_TEST, result)
  return result
}

test('a test still running past its limit interrupts the run and fails it', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const kill = context.mock.method(process, 'kill', () => true)
  const error = context.mock.method(console, 'error', () => {})
  const reporter = new VisualLimitReporter()
  startTest(reporter)

  context.mock.timers.tick(VISUAL_TEST_TIMEOUT_MS)
  assert.equal(kill.mock.callCount(), 0, 'the limit itself is left to the test timeout')

  context.mock.timers.tick(60_000)
  assert.deepEqual(kill.mock.calls[0].arguments, [process.pid, 'SIGINT'])
  assert.match(error.mock.calls[0].arguments[0], /shows the new chart was still running after 150s/)
  assert.match(error.mock.calls[0].arguments[0], /test\.setTimeout, test\.slow or testInfo\.setTimeout/)
  assert.deepEqual(await reporter.onEnd(), { status: 'failed' })
})

test('a test that ends in time leaves the run alone', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const kill = context.mock.method(process, 'kill', () => true)
  const reporter = new VisualLimitReporter()
  const result = startTest(reporter)

  reporter.onTestEnd(SPEC_TEST, result)
  context.mock.timers.tick(10 * VISUAL_TEST_TIMEOUT_MS)

  assert.equal(kill.mock.callCount(), 0)
  assert.equal(await reporter.onEnd(), undefined)
})
