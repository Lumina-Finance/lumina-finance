/**
 * Guards a button reached by keyboard looking exactly as it does hovered, with no ring. Any rule that
 * gives a control a hover look must give keyboard focus the same declarations, so a new button class
 * can't show keyboard users something other than what mouse users see
 */
import { AtRule, type Declaration, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { contrast, paint, stylesheet, THEMES, type Rgb, type Theme } from './fixtures'

// Hover rules with no keyboard focus pair: a field turns its own border on focus, a tooltip or a revealed
// edit button isn't focused itself, and a disabled control can't take focus. The checkbox, the category
// icon picker and the slider thumbs keep their border or shadow through utilities, not a hover rule here
const HOVER_WITHOUT_FOCUS_PAIR = [
  '.app-input:hover',
  '.app-input-error:hover',
  '.app-date-field:hover',
  '.app-dropdown-glass:hover',
  '.app-dropdown-row:hover .app-dropdown-row-edit',
  '.group:hover .app-tag-tooltip-glass',
]

// The hover rules of selected options in each segmented control, whose fill and text colour keep the text
// readable and which a disabled option must not take
const SELECTED_OPTIONS = [
  '.app-segmented-option-active',
  '.app-time-selector .app-segmented-option-active',
  '.app-navigation-theme-toggle .app-segmented-option-active',
  '.app-balance-chart-mode-selector .app-segmented-option-active',
  '.app-create-transaction-pill-selector .app-segmented-option-active',
]
const GUARDED_SELECTED_OPTIONS = SELECTED_OPTIONS.slice(1)

// Buttons whose hover change used to be too faint, or missing, to tell keyboard focus from rest
const BORDER_CHANGING = ['.app-secondary-button', '.app-glass-button', '.app-glass-icon-button']

// Filled buttons, whose hover look is a change of fill alone
const FILLED_BUTTONS = ['.app-primary-button', '.app-glass-button-primary', '.app-danger-button']

// The least contrast between a filled button's rest and hover fills on the page. The dark theme's primary
// button, which reads clearly as hovered, measures 1.31
const MIN_FILL_CHANGE = 1.25

type Colour = { rgb: Rgb; alpha: number }

/** Splits a list at the commas that aren't inside brackets */
function splitTopLevel(list: string): string[] {
  const parts = ['']
  let depth = 0
  for (const character of list) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) parts.push('')
    else parts[parts.length - 1] += character
  }
  return parts.map((part) => part.trim())
}

/** Resolves a colour as the stylesheet writes it, tokens and srgb mixes included, in the given theme */
function resolveColour(value: string, theme: Theme): Colour {
  const token = value.match(/^var\((--[\w-]+)\)$/)
  if (token) return resolveColour(THEMES[theme][token[1]], theme)
  if (value === 'transparent') return { rgb: [0, 0, 0], alpha: 0 }
  if (value === 'black') return { rgb: [0, 0, 0], alpha: 1 }
  const hex = value.match(/^#([\da-f]{6})([\da-f]{2})?$/i)
  if (hex) {
    const rgb = [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16)) as Rgb
    return { rgb, alpha: hex[2] ? parseInt(hex[2], 16) / 255 : 1 }
  }
  const mix = value.match(/^color-mix\(in srgb, (.*)\)$/)
  if (!mix) throw new Error(`Unreadable colour ${value}`)
  const [first, second] = splitTopLevel(mix[1]).map((part) => {
    const share = part.match(/^(.*) (\d+)%$/)
    return { colour: resolveColour(share ? share[1] : part, theme), share: share ? Number(share[2]) / 100 : null }
  })
  const firstShare = first.share ?? 1 - second.share!
  const secondShare = second.share ?? 1 - firstShare
  // Mixed with premultiplied alpha, as CSS mixes colours
  const alpha = first.colour.alpha * firstShare + second.colour.alpha * secondShare
  const rgb = first.colour.rgb.map((channel, index) => (
    channel * first.colour.alpha * firstShare + second.colour.rgb[index] * second.colour.alpha * secondShare
  ) / alpha) as Rgb
  return { rgb, alpha }
}

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

function declared(rule: Rule, property: string) {
  let value: string | undefined
  rule.walkDecls(property, (declaration) => {
    value = declaration.value
  })
  return value
}

function declarationsOf(rule: Rule): string[] {
  return rule.nodes
    .filter((node): node is Declaration => node.type === 'decl')
    .map((declaration) => `${declaration.prop}: ${declaration.value}`)
    .sort()
}

// The colour part of a border shorthand such as "1px solid var(--app-border-strong)"
function borderColourOf(rule: Rule) {
  return declared(rule, 'border')?.replace(/^\S+\s+\S+\s+/, '')
}

function isHoverOnlyMedia(rule: Rule) {
  return rule.parent instanceof AtRule && rule.parent.name === 'media' && rule.parent.params === '(hover: hover)'
}

/** The selector a keyboard user's focus looks the same as, with a disabled guard dropped as a disabled control can't be focused */
function focusCounterpart(hoverSelector: string) {
  return hoverSelector.replaceAll(':not(:disabled)', '').replaceAll(':hover', ':focus-visible')
}

interface HoverSelector {
  selector: string
  rule: Rule
}

const hoverSelectors: HoverSelector[] = []
stylesheet.walkRules((rule) => {
  for (const selector of selectorsOf(rule)) {
    const isExempt = HOVER_WITHOUT_FOCUS_PAIR.includes(selector) || selector.includes(':disabled:hover')
    // The hover variant's own rule is checked on its own below
    if (selector.includes(':hover') && !isExempt && !selector.startsWith('&')) hoverSelectors.push({ selector, rule })
  }
})

describe('button keyboard focus', () => {
  it('finds the stylesheet hover rules to pair', () => {
    expect(hoverSelectors.length).toBeGreaterThan(30)
  })

  for (const { selector, rule } of hoverSelectors) {
    it(`shows ${selector} focused by keyboard exactly as hovered`, () => {
      const focusRules = rulesListing(focusCounterpart(selector))
      expect(focusRules.length).toBeGreaterThan(0)

      // The same declarations, so the two looks can't differ by a property, a value or a later rule
      const hoverDeclarations = declarationsOf(rule)
      for (const focusRule of focusRules) {
        expect(declarationsOf(focusRule)).toEqual(hoverDeclarations)
        expect(focusRule.nodes.some((node) => node.type === 'decl' && /^outline/.test(node.prop))).toBe(false)
      }
    })

    it(`keeps ${selector} hover off touch screens unless focus shares its rule`, () => {
      const sharesRuleWithFocus = selectorsOf(rule).includes(focusCounterpart(selector))
      expect(sharesRuleWithFocus || isHoverOnlyMedia(rule)).toBe(true)
    })
  }

  for (const name of BORDER_CHANGING) {
    it(`gives ${name} a border of its own under the pointer and on keyboard focus`, () => {
      const [rest] = rulesListing(name)
      const [hover] = rulesListing(`${name}:hover`)
      expect(declared(hover, 'border-color')).toBeDefined()
      expect(declared(hover, 'border-color')).not.toBe(borderColourOf(rest))
    })
  }

  for (const name of SELECTED_OPTIONS) {
    it(`tints ${name} further under the pointer and on keyboard focus, with text that stays readable`, () => {
      const rest = rulesListing(name).find((rule) => !rule.selector.includes(':'))!
      const hover = rulesListing(`${name}:focus-visible`)[0]
      expect(hover).toBeDefined()
      expect(declared(hover, 'background')).toBe('var(--app-accent-hover-fill)')
      expect(declared(hover, 'background')).not.toBe(declared(rest, 'background'))
      // The accent itself measures under 4.5:1 on this fill
      expect(declared(hover, 'color')).toBe('var(--app-accent-on-hover-fill)')
    })
  }

  for (const name of GUARDED_SELECTED_OPTIONS) {
    it(`leaves a disabled ${name} untinted under the pointer`, () => {
      const hoverRules = rulesListing(`${name}:not(:disabled):hover`)
      expect(hoverRules.length).toBeGreaterThan(0)
    })
  }

  // Hover looks added by this change, which a touch screen would otherwise keep showing after a tap
  const POINTER_ONLY_HOVER = [
    ...SELECTED_OPTIONS.map((name) => (GUARDED_SELECTED_OPTIONS.includes(name) ? `${name}:not(:disabled):hover` : `${name}:hover`)),
    '.app-calendar-day[data-selected]:hover',
    '.app-range-glass:has(> .app-range-glass-head:hover)',
  ]
  for (const selector of POINTER_ONLY_HOVER) {
    it(`shows ${selector} only for a pointer that can hover`, () => {
      const rules = rulesListing(selector)
      expect(rules.length).toBeGreaterThan(0)
      expect(rules.every(isHoverOnlyMedia)).toBe(true)
    })
  }

  // A navigation item that isn't selected used to take the selected item's own fill and colour under the
  // pointer and on keyboard focus, so a focused item read as a second selected one, and the selected item
  // showed no change at all
  it('tells a hovered or focused navigation item apart from the selected one', () => {
    const [hover] = rulesListing('.app-nav-link:focus-visible')
    const [selected] = rulesListing('.app-nav-link-active')
    expect(declared(hover, 'background')).toBeDefined()
    expect(declared(hover, 'background')).not.toBe(declared(selected, 'background'))
    expect(declared(hover, 'color')).not.toBe(declared(selected, 'color'))
  })

  it('tints the selected navigation item further under the pointer and on keyboard focus', () => {
    const [selected] = rulesListing('.app-nav-link-active')
    const [hover] = rulesListing('.app-nav-link-active:focus-visible')
    expect(hover).toBeDefined()
    expect(declared(hover, 'background')).toBe('var(--app-accent-hover-fill)')
    expect(declared(hover, 'background')).not.toBe(declared(selected, 'background'))
    expect(declared(hover, 'color')).toBe('var(--app-accent-on-hover-fill)')
  })

  // A filled button's hover fill used to land on the same colour as its rest fill in the light theme, so
  // keyboard focus, which now shows only the hover look, couldn't be seen
  for (const theme of ['light', 'dark'] as const) {
    for (const name of FILLED_BUTTONS) {
      it(`changes ${name}'s fill visibly under the pointer and on keyboard focus in the ${theme} theme`, () => {
        const [rest] = rulesListing(name)
        const [hover] = rulesListing(`${name}:focus-visible`)
        const page = resolveColour('var(--app-bg)', theme).rgb
        const onPage = (rule: Rule) => {
          const fill = resolveColour(declared(rule, 'background')!, theme)
          return paint(fill.rgb, fill.alpha, page)
        }
        expect(contrast(onPage(rest), onPage(hover))).toBeGreaterThanOrEqual(MIN_FILL_CHANGE)
      })
    }
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
