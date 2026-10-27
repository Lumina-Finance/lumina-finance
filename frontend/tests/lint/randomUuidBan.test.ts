/**
 * Verifies the lint ban on crypto.randomUUID catches every way of reaching it, and still lets the shared
 * random id helper through
 */
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const frontendRoot = fileURLToPath(new URL('../..', import.meta.url))
const eslint = new ESLint({ cwd: frontendRoot })

async function lintMessages(code: string) {
  const [result] = await eslint.lintText(code, { filePath: `${frontendRoot}src/utils/example.ts` })

  return result.messages
}

describe('randomUUID lint ban', () => {
  it.each([
    ['a direct call', 'crypto.randomUUID()'],
    ['a global path', 'globalThis.crypto.randomUUID()'],
    ['a window path', 'window.crypto.randomUUID()'],
    ['a longer window path', 'window.self.crypto.randomUUID()'],
    ['a bracket call', "crypto['randomUUID']()"],
    ['a template bracket call', 'crypto[`randomUUID`]()'],
    ['a destructured call', 'const { randomUUID } = crypto\nrandomUUID()'],
    ['a renamed destructure', 'const { randomUUID: make } = crypto\nmake()'],
    ['an alias of the crypto object', 'const c = crypto\nc.randomUUID()'],
    ['a prototype call', 'Crypto.prototype.randomUUID.call(crypto)'],
  ])('refuses %s', async (_name, code) => {
    const messages = await lintMessages(code)

    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((message) => message.message.includes('createRandomId from @/utils/randomId'))).toBe(true)
  })

  it('lets the shared random id helper through', async () => {
    const messages = await lintMessages(
      "import { createRandomId } from '@/utils/randomId'\nexport const id = createRandomId()",
    )

    expect(messages).toEqual([])
  })
})
