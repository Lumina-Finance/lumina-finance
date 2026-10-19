import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SUITE_DIR = fileURLToPath(new URL('..', import.meta.url))

// Where specs and the code they share live. The contracts and the installed packages are not part of it
const SOURCE_DIRECTORIES = ['tests', 'support', 'firefly-check', 'actual-check']

// The one file that defines the helpers, so the only one allowed to do what they do
const HELPERS_FILE = 'support/api.ts'

// What a spec must not write itself, with the helper that does it
const RULES = [
  { pattern: /Bearer[^\n]*accessToken|accessToken[^\n]*Bearer/, message: 'builds an Authorization header by hand, use asUser(user) from support/api' },
  { pattern: /\/auth\/signup/, message: 'posts to /auth/signup itself, use signUpUser(request) from support/api' },
]

/**
 * Lists the rules a source file breaks, each with the line it breaks it on
 */
function findViolations(path, source) {
  if (path === HELPERS_FILE) return []
  return source.split('\n').flatMap((line, index) =>
    RULES.filter(({ pattern }) => pattern.test(line)).map(({ message }) => `${path}:${index + 1} ${message}`),
  )
}

test('a hand-built bearer header fails the check with a message naming asUser', () => {
  const violations = findViolations('tests/a.spec.ts', 'const headers = { Authorization: `Bearer ${user.accessToken}` }')
  assert.equal(violations.length, 1)
  assert.match(violations[0], /asUser/)
})

test('a post to /auth/signup fails the check with a message naming signUpUser', () => {
  const violations = findViolations('tests/a.spec.ts', "await request.post(`${API_BASE_URL}/auth/signup`, { data })")
  assert.equal(violations.length, 1)
  assert.match(violations[0], /signUpUser/)
})

test('the file that defines the helpers passes', () => {
  const source = readFileSync(join(SUITE_DIR, HELPERS_FILE), 'utf8')
  assert.match(source, /\/auth\/signup/)
  assert.deepEqual(findViolations(HELPERS_FILE, source), [])
})

test('a spec using asUser and signUpUser passes', () => {
  const source = 'const user = await signUpUser(request)\nawait request.get(url, { headers: asUser(user) })'
  assert.deepEqual(findViolations('tests/a.spec.ts', source), [])
})

test('no spec or support file builds its own sign-up or auth header', () => {
  const violations = SOURCE_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(SUITE_DIR, directory), { recursive: true })
      .filter((file) => file.endsWith('.ts') && !file.includes('node_modules'))
      .flatMap((file) => {
        const path = `${directory}/${file}`
        return findViolations(path, readFileSync(join(SUITE_DIR, path), 'utf8'))
      }),
  )
  assert.deepEqual(violations, [])
})
