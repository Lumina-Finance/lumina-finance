/**
 * Guards the rule that a date range joins its ends with an en dash that has a normal space on both sides,
 * by failing on any frontend source text that writes one with no space, a thin or no-break space, or a hyphen
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceRoot = fileURLToPath(new URL('../../src', import.meta.url))

const EN_DASH = '–'
// Spaces a browser's range formatter writes around its dash instead of a normal one
const ODD_SPACES = '\\u00a0\\u2009\\u202f\\u2002-\\u200a'
const THIN_SPACE = String.fromCodePoint(0x2009)
const NO_BREAK_SPACE = String.fromCodePoint(0x00a0)
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*'
const ISO_DATE = '\\d{4}-\\d{2}-\\d{2}'

const DASH_RULES = [
  {
    name: 'an en dash touching a letter or digit',
    pattern: new RegExp(`[0-9A-Za-z]${EN_DASH}|${EN_DASH}[0-9A-Za-z]`),
  },
  {
    name: 'an en dash beside a thin, no-break or other special space',
    pattern: new RegExp(`[${ODD_SPACES}]${EN_DASH}|${EN_DASH}[${ODD_SPACES}]`),
  },
  {
    name: 'a hyphen between two ISO dates',
    pattern: new RegExp(`${ISO_DATE}\\s*-\\s*${ISO_DATE}`),
  },
  {
    name: 'a hyphen between two dates written with month names',
    pattern: new RegExp(`${MONTH} \\d{1,2}(?:, \\d{4})?\\s*-\\s*(?:${MONTH} )?\\d{1,2}\\b`),
  },
  {
    name: 'a hyphen between two formatted dates',
    pattern: /formatDate\w*\([^)]*\)\}\s*-\s*\$\{/,
  },
]

function listSourceFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = `${folder}/${entry.name}`
    if (entry.isDirectory()) return listSourceFiles(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

function findDashProblems(text: string): string[] {
  return text
    .split('\n')
    .flatMap((line, index) =>
      DASH_RULES.filter((rule) => rule.pattern.test(line)).map((rule) => `line ${index + 1}: ${rule.name}`),
    )
}

describe('date range dash', () => {
  it.each([
    ['an unspaced en dash', `Jun 1${EN_DASH}30, 2026`],
    ['an en dash with a thin space', `Jun 1${THIN_SPACE}${EN_DASH}${THIN_SPACE}30, 2026`],
    ['an en dash with a no-break space', `Jun 1${NO_BREAK_SPACE}${EN_DASH} 30, 2026`],
    ['a hyphen between ISO dates', '2026-06-01 - 2026-06-30'],
    ['a hyphen between month names', 'Oct 25 - Nov 4, 2026'],
    ['a hyphen after a day', 'Jun 1-30, 2026'],
    ['a hyphen between formatted dates', '`${formatDate(start, format)} - ${formatDate(end, format)}`'],
  ])('is found in %s', (_name, text) => {
    expect(findDashProblems(text)).not.toEqual([])
  })

  it('leaves a spaced en dash, a lone placeholder dash and an ISO date alone', () => {
    expect(findDashProblems(`Oct 1 ${EN_DASH} 31, 2026`)).toEqual([])
    expect(findDashProblems(`const EMPTY_CELL = '${EN_DASH}'`)).toEqual([])
    expect(findDashProblems('const ymd = "2026-10-01"')).toEqual([])
  })

  it('is absent from frontend source', () => {
    const problems = listSourceFiles(sourceRoot).flatMap((path) =>
      findDashProblems(readFileSync(path, 'utf8')).map((problem) => `${path.slice(sourceRoot.length + 1)} ${problem}`),
    )

    expect(problems).toEqual([])
  })
})
