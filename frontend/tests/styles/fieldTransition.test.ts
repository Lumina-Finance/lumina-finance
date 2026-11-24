/**
 * Guards every bordered text field frame built from utilities taking the field transition, so its border
 * and inner focus line fade together over the focus fade. A frame left on `transition-colors` fades its
 * border over the long duration while the inner line appears at once
 */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = new URL('../../src/', import.meta.url)

/** The source lines naming a field focus class, with or without the visible variant, as `file:line` and text */
function frameLines(directory: URL, prefix = ''): { where: string; line: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return frameLines(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`)
    if (!/\.tsx$/.test(entry.name)) return []
    return readFileSync(new URL(entry.name, directory), 'utf8')
      .split('\n')
      .map((line, index) => ({ where: `${prefix}${entry.name}:${index + 1}`, line }))
      .filter(({ line }) => /(^|[\s"'`])app-field-focus(-visible)?([\s"'`]|$)/.test(line))
  })
}

describe('field frames', () => {
  const lines = frameLines(SOURCE_ROOT)

  it('finds the frames it checks', () => {
    expect(lines.length).toBeGreaterThan(5)
  })

  // A frame that is also an app-input takes the transition from that class
  it('take the field transition, in place of the colour transition that fades the inner line at once', () => {
    const offenders = lines
      .filter(({ line }) => !/\bapp-input\b/.test(line) && !/\btransition-field\b/.test(line))
      .map(({ where }) => where)
    expect(offenders).toEqual([])
  })
})
