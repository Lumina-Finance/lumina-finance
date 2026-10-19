/**
 * Guards a button reached by keyboard looking exactly as it does hovered, with no ring. A shared button
 * class that gives its hover look a rule of its own, or a focus rule that draws an outline or a border,
 * would show keyboard users something other than what mouse users see
 */
import { readFileSync } from 'node:fs'
import { parse, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../src/styles/tailwind.css', import.meta.url), 'utf8')
const stylesheet = parse(source)

// The classes that draw a button, each scoped the way its hover rule is
const BUTTON_SELECTORS = [
  '.app-primary-button',
  '.app-secondary-button',
  '.app-danger-button',
  '.app-glass-button-primary',
  '.app-glass-button',
  '.app-glass-icon-button',
  '.app-icon-button',
  '.app-dropdown-search .app-icon-button',
  '.app-segmented-option',
  '.app-time-selector .app-segmented-option',
  '.app-time-selector .app-segmented-option-active',
  '.app-navigation-theme-toggle .app-segmented-option',
  '.app-navigation-theme-toggle .app-segmented-option-active',
  '.app-balance-chart-mode-selector .app-segmented-option',
  '.app-balance-chart-mode-selector .app-segmented-option-active',
  '.app-create-transaction-pill-selector .app-segmented-option',
  '.app-create-transaction-pill-selector .app-segmented-option-active',
  '.app-nav-link',
  '.app-calendar-day',
  '.app-dropdown-row-edit',
  '.app-range-apply',
  '.app-range-glass-clear',
  '.app-range-seg-option',
  '.app-range-unit-option',
  '.app-upload-card:not([aria-disabled="true"])',
]

function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map((selector) => selector.trim())
}

function rulesListing(selector: string): Rule[] {
  const rules: Rule[] = []
  stylesheet.walkRules((rule) => {
    if (selectorsOf(rule).includes(selector)) rules.push(rule)
  })
  return rules
}

describe('button keyboard focus', () => {
  for (const base of BUTTON_SELECTORS) {
    it(`shows ${base} focused by keyboard exactly as hovered`, () => {
      const hoverRules = rulesListing(`${base}:hover`)
      const focusRules = rulesListing(`${base}:focus-visible`)
      expect(hoverRules.length).toBeGreaterThan(0)

      // The same rules, so the two looks can't differ by a declaration, a weight or a later rule
      expect(focusRules).toHaveLength(hoverRules.length)
      expect(hoverRules.every((rule) => focusRules.includes(rule))).toBe(true)
      for (const rule of focusRules) {
        expect(rule.nodes.some((node) => node.type === 'decl' && /^outline/.test(node.prop))).toBe(false)
      }
    })
  }

  it('draws no ring on a button that has no hover look of its own', () => {
    const rules = rulesListing(':is(button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], .app-nav-link):not(svg *):focus-visible')
    expect(rules).toHaveLength(1)
    expect(rules[0].nodes.map((node) => node.toString())).toEqual(['outline: none'])
  })

  it('applies every hover: utility on a button while it is keyboard focused', () => {
    let variant = ''
    stylesheet.walkAtRules('custom-variant', (rule) => {
      if (rule.params === 'hover') variant = rule.toString()
    })
    expect(variant).toContain('&:hover')
    expect(variant).toMatch(/&:is\(button, \[role="button"\][^)]*\):focus-visible/)
  })
})
