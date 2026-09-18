import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'postcss'
import { describe, expect, it } from 'vitest'
import { STACKING_LEVELS, toTailwindZIndexTheme } from '@/constants/stackingLevels'

// Stylesheet literals only order nearby siblings, global overlays use the named Tailwind scale
const LOCAL_STYLESHEET_LEVELS = new Set(['auto', '0', '1', '2'])

/** Parse declarations so comments and strings mentioning z-index do not become false positives */
function findUnsupportedStylesheetLevels(css: string): string[] {
  const namedLevels = toTailwindZIndexTheme()
  const unsupported: string[] = []

  parse(css).walkDecls((declaration) => {
    if (declaration.prop.toLowerCase() !== 'z-index') return
    const value = declaration.value.trim()
    if (LOCAL_STYLESHEET_LEVELS.has(value)) return

    const themeReference = /^theme\(\s*(['"])zIndex\.([a-z-]+)\1\s*\)$/.exec(value)
    if (themeReference && Object.hasOwn(namedLevels, themeReference[2])) return

    unsupported.push(value)
  })

  return unsupported
}

describe('stylesheet stacking levels', () => {
  it.each(['auto', '0', '1', '2', "theme('zIndex.popover')", 'theme("zIndex.stacked-modal")'])(
    'accepts local ordering or a named level: %s', (value) => {
      expect(findUnsupportedStylesheetLevels(`.example { z-index: ${value} !important; }`)).toEqual([])
    },
  )

  it.each(['110', '-1', '3', "theme('zIndex.missing')", 'var(--unknown-level)', 'calc(100 + 10)'])(
    'rejects unsupported levels: %s', (value) => {
      expect(findUnsupportedStylesheetLevels(`@media (min-width: 1px) { .example { z-index: ${value}; } }`))
        .toEqual([value])
    },
  )

  it('ignores comments, custom properties and unrelated declaration values', () => {
    expect(findUnsupportedStylesheetLevels(`
      /* z-index: 110; */
      .example { content: "z-index: 110"; --z-index: 110; width: 110px; }
    `)).toEqual([])
  })

  it('keeps handwritten stylesheet levels within the local range or named scale', () => {
    const stylesheet = readFileSync(new URL('../../src/styles/tailwind.css', import.meta.url), 'utf8')
    expect(findUnsupportedStylesheetLevels(stylesheet)).toEqual([])
  })
})

describe('STACKING_LEVELS', () => {
  it('rises strictly from the first level to the last', () => {
    const values = Object.values(STACKING_LEVELS)

    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThan(values[index - 1])
    }
  })

  // Two levels at one number is the bug the scale exists to remove: the browser then falls back to
  // document order, so which overlay paints on top depends on which one React happened to append
  it('gives no two levels the same number', () => {
    const values = Object.values(STACKING_LEVELS)

    expect(new Set(values).size).toBe(values.length)
  })

  it('puts a toast and a pointer tooltip above every popover, and every popover above every dialog', () => {
    expect(STACKING_LEVELS.popover).toBeGreaterThan(STACKING_LEVELS.stackedModal)
    expect(STACKING_LEVELS.toast).toBeGreaterThan(STACKING_LEVELS.popover)
    expect(STACKING_LEVELS.tooltip).toBeGreaterThan(STACKING_LEVELS.toast)
  })

  it('puts a dialog opened from another dialog above every full-screen cover', () => {
    expect(STACKING_LEVELS.stackedModal).toBeGreaterThan(STACKING_LEVELS.sheet)
    expect(STACKING_LEVELS.sheet).toBeGreaterThan(STACKING_LEVELS.modal)
  })
})

describe('toTailwindZIndexTheme', () => {
  // Written out rather than derived from STACKING_LEVELS, so this fails on a renamed level, a changed
  // value and a broken transform alike. Deriving the expectation from the same object would pass
  // whatever the transform did to the keys.
  //
  // Tailwind puts a theme key into the class name exactly as written, so a key left camelCase emits
  // z-navigationToggle and emits nothing for the class the markup asks for. Neither the build nor the
  // type check nor the suite reports that on its own, which is what the next test covers
  it('generates exactly the kebab-case keys the markup asks for', () => {
    expect(toTailwindZIndexTheme()).toEqual({
      'page-overlay': '30',
      navigation: '40',
      'navigation-toggle': '50',
      'loading-screen': '55',
      'focused-page': '60',
      modal: '65',
      notice: '70',
      menu: '80',
      sheet: '90',
      'stacked-modal': '100',
      popover: '110',
      toast: '115',
      tooltip: '120',
    })
  })
})

// Tailwind drops a class it cannot resolve without reporting it, so a level renamed in the scale and
// left alone in the markup takes that overlay's stacking level away with nothing failing. This walks
// the source for what the markup actually asks for and holds it against what the theme generates
describe('the classes the markup asks for', () => {
  const SOURCE_ROOT = fileURLToPath(new URL('../../src', import.meta.url))

  // Tailwind's own numeric scale survives alongside the named one for a level ordering siblings
  // inside one container, and z-auto is Tailwind's too. "index" is the CSS property named in a comment
  const CLASSES_NOT_FROM_THE_SCALE = new Set(['auto', 'index'])

  /** Every .ts and .tsx file under src, so the walk covers markup and the helpers building it */
  function collectSourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return collectSourceFiles(path)

      return /\.tsx?$/.test(entry.name) ? [path] : []
    })
  }

  it('generates every one of them', () => {
    const generated = toTailwindZIndexTheme()
    const missing = new Map<string, string[]>()

    for (const file of collectSourceFiles(SOURCE_ROOT)) {
      // A letter-led suffix, so Tailwind's numeric z-30 and the rejected arbitrary z-[30] are left out
      for (const [, suffix] of readFileSync(file, 'utf8').matchAll(/\bz-([a-z][a-z-]*)\b/g)) {
        if (CLASSES_NOT_FROM_THE_SCALE.has(suffix) || suffix in generated) continue

        missing.set(suffix, [...(missing.get(suffix) ?? []), file.slice(SOURCE_ROOT.length + 1)])
      }
    }

    expect(Object.fromEntries(missing)).toEqual({})
  })
})
