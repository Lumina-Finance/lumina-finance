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
