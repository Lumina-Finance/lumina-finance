import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SUITE_DIR = fileURLToPath(new URL('..', import.meta.url))

const ACROSS_ORIGINS = 'across-origins'
const ONE_ADDRESS = 'one-address'

// The report lists a tag without the @ it is written with in the test and the config
const hasTag = ({ tags }, name) => tags.some((tag) => tag.replace(/^@/, '') === name)

// The same host on two ports, as the packaged image's CI stack serves the app and an API elsewhere
const ONE_ADDRESS_TARGET = { E2E_BASE_URL: 'http://app.example:8080' }
const API_ELSEWHERE_TARGET = { E2E_BASE_URL: 'http://app.example:8080', E2E_API_BASE_URL: 'http://app.example:8081/api' }

/**
 * The tests a project would run against a target, listed by Playwright with the suite's own config
 *
 * @param project - Name of a project in the config
 * @param target - The addresses the run is handed
 */
function listTests(project, target) {
  const env = { ...process.env }
  for (const name of Object.keys(env)) if (name.startsWith('E2E_')) delete env[name]
  const result = spawnSync('node_modules/.bin/playwright', ['test', '--list', '--reporter=json', `--project=${project}`], {
    cwd: SUITE_DIR,
    env: { ...env, ...target },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr)
  return collect(JSON.parse(result.stdout).suites)
}

function collect(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).map((spec) => ({
      title: spec.title,
      tags: spec.tags,
      annotations: spec.tests.flatMap((test) => test.annotations),
    })),
    ...collect(suite.suites ?? []),
  ])
}

test('against an API at another address the tests that need two run and those written for one stay out', () => {
  for (const project of ['desktop', 'tablet', 'phone']) {
    const tests = listTests(project, API_ELSEWHERE_TARGET)
    assert.deepEqual(tests.filter((spec) => hasTag(spec, ONE_ADDRESS)).map(({ title }) => title), [], project)
  }
  const desktop = listTests('desktop', API_ELSEWHERE_TARGET)
  assert.notEqual(desktop.filter((spec) => hasTag(spec, ACROSS_ORIGINS)).length, 0)
  assert.ok(desktop.length > 100, `only ${desktop.length} tests run on desktop`)
})

test('against the packaged image\'s one address the tests that need two stay out and the rest run', () => {
  for (const project of ['desktop', 'tablet', 'phone']) {
    const tests = listTests(project, ONE_ADDRESS_TARGET)
    assert.deepEqual(tests.filter((spec) => hasTag(spec, ACROSS_ORIGINS)).map(({ title }) => title), [], project)
  }
  const desktop = listTests('desktop', ONE_ADDRESS_TARGET)
  assert.notEqual(desktop.filter((spec) => hasTag(spec, ONE_ADDRESS)).length, 0)
  assert.ok(desktop.length > 100, `only ${desktop.length} tests run on desktop`)
})

test('every test left out of a run against an API elsewhere says why', () => {
  const leftOut = listTests('desktop', ONE_ADDRESS_TARGET).filter((spec) => hasTag(spec, ONE_ADDRESS))
  assert.notEqual(leftOut.length, 0)
  const unexplained = leftOut.filter(
    ({ annotations }) => !annotations.some(({ type, description }) => type === 'one-address' && (description ?? '').trim() !== ''),
  )
  assert.deepEqual(unexplained.map(({ title }) => title), [])
})
