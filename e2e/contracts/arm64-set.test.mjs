import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SUITE_DIR = fileURLToPath(new URL('..', import.meta.url))

/**
 * Lists the test declarations in the specs that carry the arm64 tag, each with its file and line
 */
function findArm64Tests() {
  return readdirSync(join(SUITE_DIR, 'tests'))
    .filter((file) => file.endsWith('.spec.ts'))
    .flatMap((file) =>
      readFileSync(join(SUITE_DIR, 'tests', file), 'utf8')
        .split('\n')
        .map((text, index) => ({ file, line: index + 1, text }))
        .filter(({ text }) => /\bON_ARM64\b/.test(text) && !/^(import|\s*\/\/)/.test(text)),
    )
}

// The arm64 job in the workflow fails when the tag selects no test, and this is the same check
// made before a push
test('at least one test carries the arm64 tag', () => {
  assert.notEqual(findArm64Tests().length, 0)
})

// The arm64 job runs only against the server with no bank provider, so a tagged test needing one
// would never run
test('no arm64 test needs bank sync', () => {
  const needingBankSync = findArm64Tests().filter(({ text }) => /NEEDS_BANK_SYNC\b/.test(text))
  assert.deepEqual(needingBankSync.map(({ file, line }) => `${file}:${line}`), [])
})
