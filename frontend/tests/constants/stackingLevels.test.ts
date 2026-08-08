import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { STACKING_LEVELS, toTailwindZIndexTheme } from '@/constants/stackingLevels'

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
