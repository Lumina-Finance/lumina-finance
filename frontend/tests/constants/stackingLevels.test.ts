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
  // Tailwind's compatibility layer for a JavaScript config kebab-cases only the first segment of a
  // key path, so a key left camelCase reaches the stylesheet as z-navigationToggle while the markup
  // asks for z-navigation-toggle, and a class matching nothing fails without an error anywhere
  it('kebab-cases a multi-word level so the class name matches the markup', () => {
    const theme = toTailwindZIndexTheme()

    expect(theme['navigation-toggle']).toBe('50')
    expect(theme['stacked-modal']).toBe('100')
    expect(theme['loading-screen']).toBe('55')
    expect(theme['page-overlay']).toBe('30')
    expect(theme['focused-page']).toBe('60')
  })

  it('leaves a single-word level alone', () => {
    const theme = toTailwindZIndexTheme()

    expect(theme.modal).toBe('65')
    expect(theme.popover).toBe('110')
    expect(theme.tooltip).toBe('120')
  })

  it('carries every level across', () => {
    expect(Object.keys(toTailwindZIndexTheme())).toHaveLength(Object.keys(STACKING_LEVELS).length)
  })
})
