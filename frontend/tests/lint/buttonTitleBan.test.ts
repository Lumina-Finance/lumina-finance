/**
 * Verifies the lint ban on a native title attribute on a button catches each way of writing one, and
 * still lets the app tooltip and a title on an element that is not a button through
 */
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const frontendRoot = fileURLToPath(new URL('../..', import.meta.url))
const eslint = new ESLint({ cwd: frontendRoot })

async function lintMessages(code: string) {
  const [result] = await eslint.lintText(code, { filePath: `${frontendRoot}src/components/Example.tsx` })

  return result.messages
}

describe('button title lint ban', () => {
  it.each([
    ['a plain button', 'export const A = () => <button type="button" title="Save">S</button>'],
    ['a dynamic title', 'export const A = ({ t }: { t: string }) => <button title={t}>S</button>'],
    ['a motion button', 'export const A = () => <motion.button title="Save">S</motion.button>'],
    ['a button component', 'export const A = () => <IconButton title="Save">S</IconButton>'],
    ['a disabled reason button', 'export const A = () => <DisabledReasonButton title="Save">S</DisabledReasonButton>'],
  ])('refuses %s', async (_name, code) => {
    const messages = await lintMessages(code)

    expect(messages.length).toBeGreaterThan(0)
    expect(messages.every((message) => message.message.includes('HintButton or useControlHint'))).toBe(true)
  })

  it.each([
    ['a hint button', 'export const A = () => <HintButton hint="Save" aria-label="Save">S</HintButton>'],
    ['a plain button', 'export const A = () => <button type="button" aria-label="Save">S</button>'],
    ['a modal title', 'export const A = () => <Modal title="Edit budget" />'],
    ['a truncated label', 'export const A = () => <span title="Long name">Long name</span>'],
  ])('lets %s through', async (_name, code) => {
    const messages = await lintMessages(code)

    expect(messages).toEqual([])
  })
})
