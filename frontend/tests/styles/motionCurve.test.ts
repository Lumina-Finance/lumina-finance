/**
 * Guards every cubic-bezier easing in the stylesheet being the app's one ease-out, so a menu item, a
 * settings link, a checklist row, a transaction row or any other rule can't ease on Material's standard
 * curve and start and settle differently from the buttons and dropdowns beside it
 */
import type { Declaration } from 'postcss'
import { describe, expect, it } from 'vitest'
import { stylesheet } from './fixtures'

const APP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const MATERIAL_EASE = /cubic-bezier\(\s*0?\.4\s*,\s*0\s*,\s*0?\.2\s*,\s*1\s*\)/

describe('hover and colour transitions', () => {
  it('never ease on the standard Material curve', () => {
    const offenders: string[] = []
    stylesheet.walkDecls((decl: Declaration) => {
      if (MATERIAL_EASE.test(decl.value)) {
        offenders.push(decl.parent && 'selector' in decl.parent ? String(decl.parent.selector) : '?')
      }
    })
    expect(offenders).toEqual([])
  })

  it.each(['.app-nav-link', '.app-focus-inset', '.app-transaction-row'])('%s eases on the app curve', (selector) => {
    const values: string[] = []
    stylesheet.walkRules(selector, (rule) => {
      rule.walkDecls('transition', (decl) => values.push(decl.value))
    })
    expect(values.length).toBeGreaterThan(0)
    expect(values.every((value) => value.includes(APP_EASE))).toBe(true)
  })
})

/** Splits a transition value at its top-level commas, keeping cubic-bezier's own commas together */
function splitTransitions(value: string): string[] {
  return value.split(/,\s*(?![^()]*\))/)
}

describe('hover looks that name their own transition', () => {
  const HOVER_SELECTORS = [
    '.app-nav-user',
    '.app-dropdown-glass',
    '.app-dropdown-row',
    '.app-dropdown-row-edit',
    '.app-range-glass',
    '.app-range-glass-clear',
    '.app-range-seg-option',
    '.app-time-selector .app-segmented-option',
    '.app-navigation-theme-toggle',
    '.app-navigation-theme-toggle .app-segmented-option',
    '.app-balance-chart-mode-selector .app-segmented-option',
    '.app-create-transaction-pill-selector .app-segmented-option',
    '.app-tag-tooltip-glass',
  ]

  it.each(HOVER_SELECTORS)('%s eases every entry on the app curve', (selector) => {
    const entries: string[] = []
    stylesheet.walkRules(selector, (rule) => {
      rule.walkDecls('transition', (decl) => entries.push(...splitTransitions(decl.value)))
    })
    expect(entries.length).toBeGreaterThan(0)
    // Reduced motion's own `transition: none` names no curve
    expect(entries.filter((entry) => entry !== 'none' && !entry.includes(APP_EASE) && !entry.includes('var('))).toEqual(
      [],
    )
  })

  it('makes the curve a transition utility takes when it names none the app curve', () => {
    const values: string[] = []
    stylesheet.walkAtRules('theme', (rule) => {
      rule.walkDecls('--default-transition-timing-function', (decl) => values.push(decl.value))
    })
    expect(values).toEqual([APP_EASE])
  })

  it('eases an underlined button through a registered length, since Chromium never transitions the thickness itself', () => {
    const transitions: string[] = []
    stylesheet.walkRules('button.underline', (rule) => {
      rule.walkDecls('transition', (decl) => transitions.push(decl.value))
      rule.walkDecls('text-decoration-thickness', (decl) => expect(decl.value).toBe('var(--app-underline-thickness)'))
    })
    expect(transitions.join(',')).toContain(`--app-underline-thickness 150ms ${APP_EASE}`)
  })
})
