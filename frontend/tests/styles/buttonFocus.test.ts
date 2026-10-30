/**
 * Guards a button reached by keyboard looking exactly as it does hovered, and drawing the ring only when
 * it has no border of its own. Any rule that gives a control a hover look must give keyboard focus the
 * same declarations, so a new button class can't show keyboard users something other than what mouse
 * users see
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
  // A toggle switch's input is hidden, so its focus is the input's and its track is the sibling, which the
  // toggle switch tests below pair with this rule
  'label:hover .app-switch-input:not(:disabled) + .app-switch-track',
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
const BORDER_CHANGING = [
  '.app-secondary-button',
  '.app-glass-button',
  '.app-glass-icon-button',
  '.app-expanding-button',
  '.app-nav-link',
]

// Filled buttons, whose hover look is a change of fill alone
const FILLED_BUTTONS = ['.app-primary-button', '.app-glass-button-primary', '.app-danger-button']

// The shared buttons that can be unavailable for a reason, which keeps them hoverable and focusable and
// marks them aria-disabled. Their hover, press and keyboard looks are written for the others only
const REASON_GUARD = ':not([aria-disabled="true"])'
const REASON_GUARDED = [...FILLED_BUTTONS, '.app-secondary-button', '.app-glass-button', '.app-expanding-button']

/** A button class with the guard its hover, press and focus rules carry, when it has one */
function guarded(name: string) {
  return REASON_GUARDED.includes(name) ? `${name}${REASON_GUARD}` : name
}

// The least contrast between a filled button's rest and hover fills on the page. The dark theme's primary
// button, which reads clearly as hovered, measures 1.31
const MIN_FILL_CHANGE = 1.25

// The same for a toggle switch's track, which is a plain fill beside the ring
const MIN_SWITCH_CHANGE = 1.25

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
  const rgb = first.colour.rgb.map(
    (channel, index) =>
      (channel * first.colour.alpha * firstShare + second.colour.rgb[index] * second.colour.alpha * secondShare) /
      alpha,
  ) as Rgb
  return { rgb, alpha }
}

/** A rule's selectors with the line breaks a long :is() list is written across closed up */
function selectorsOf(rule: Rule): string[] {
  return rule.selectors.map((selector) =>
    selector
      .replace(/\(\s+/g, '(')
      .replace(/,\s+/g, ', ')
      .replace(/,?\s+\)/g, ')')
      .trim(),
  )
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
      // Apart from the gap a clipped container gives the ring, which belongs to the ring and not the look
      const focusRules = rulesListing(focusCounterpart(selector)).filter(
        (focusRule) => declared(focusRule, 'outline-offset') === undefined,
      )
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
      const [hover] = rulesListing(`${guarded(name)}:hover`)
      expect(declared(hover, 'border-color')).toBeDefined()
      expect(declared(hover, 'border-color')).not.toBe(borderColourOf(rest))
    })
  }

  // The icon button that grows a label draws its border only under the pointer and on keyboard focus
  it('rests .app-expanding-button with a clear border', () => {
    const restRules = rulesListing('.app-expanding-button').filter((rule) => !rule.selector.includes(':'))
    expect(restRules.map((rule) => declared(rule, 'border-color'))).toContain('transparent')
  })

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
    ...SELECTED_OPTIONS.map((name) =>
      GUARDED_SELECTED_OPTIONS.includes(name) ? `${name}:not(:disabled):hover` : `${name}:hover`,
    ),
    '.app-nav-link:hover',
    '.app-nav-link-active:hover',
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

  // A menu item under the pointer or on keyboard focus takes the accent look the selected item rests in,
  // selected or not, and keyboard focus shows exactly that look
  it('gives a hovered or focused menu item the accent text, soft fill and border', () => {
    const [focus] = rulesListing('.app-nav-link:focus-visible')
    const [hover] = rulesListing('.app-nav-link:hover')
    for (const rule of [focus, hover]) {
      expect(declared(rule, 'color')).toBe('var(--app-accent-nav-text)')
      expect(declared(rule, 'background')).toBe('var(--app-accent-soft)')
      expect(declared(rule, 'border-color')).toBe('var(--app-accent-border)')
    }
  })

  // The sidebar's log out button and collapse toggle are icon buttons that take the menu items' look, so
  // they must declare it after the icon button rules, which share their weight, and show no ring on focus.
  for (const name of ['.app-nav-user-logout', '.app-desktop-nav-toggle']) {
    it(`gives ${name} the menu item's accent look under the pointer and on keyboard focus, after the icon button`, () => {
      const [item] = rulesListing('.app-nav-link:hover')
      const hover = rulesListing(`${name}:hover`)
      const focus = rulesListing(`${name}:focus-visible`)
      expect(hover).toHaveLength(1)
      expect(focus).toEqual(hover)
      for (const property of ['color', 'background', 'border-color']) {
        expect(declared(hover[0], property)).toBe(declared(item, property))
      }
      const [iconButton] = rulesListing('.app-icon-button:hover')
      expect(hover[0].source!.start!.offset).toBeGreaterThan(iconButton.source!.start!.offset)
    })
  }

  // The rows and toggles on shaded surfaces opt in with app-accent-hover to the menu items' accent text and soft
  // fill, with no border, so nothing shifts and keyboard focus keeps the ring. They show on touch screens too, so
  // the pointer look sits in the hover-only media query and a tap leaves nothing stuck
  it("gives .app-accent-hover the menu item's text and fill with no border, under the pointer only on hover screens", () => {
    const [item] = rulesListing('.app-nav-link:hover')
    const hover = rulesListing('.app-accent-hover:hover')
    const focus = rulesListing('.app-accent-hover:focus-visible')
    expect(hover).toHaveLength(1)
    expect(focus).toHaveLength(1)
    expect(isHoverOnlyMedia(hover[0])).toBe(true)
    expect(isHoverOnlyMedia(focus[0])).toBe(false)
    expect(declarationsOf(focus[0])).toEqual(declarationsOf(hover[0]))
    for (const property of ['color', 'background']) {
      expect(declared(hover[0], property)).toBe(declared(item, property))
    }
    expect(declared(hover[0], 'border-color')).toBeUndefined()
    expect(rulesListing('.app-accent-hover').filter((rule) => declared(rule, 'border') !== undefined)).toHaveLength(0)
    const [iconButton] = rulesListing('.app-icon-button:hover')
    expect(hover[0].source!.start!.offset).toBeGreaterThan(iconButton.source!.start!.offset)
  })

  // The selected item rests in the accent look, so keyboard focus can only show on its border, which turns
  // stronger than its resting one, and the pointer shows the same border
  it("strengthens only the selected menu item's border on keyboard focus and under the pointer", () => {
    const [selected] = rulesListing('.app-nav-link-active')
    const [focus] = rulesListing('.app-nav-link-active:focus-visible')
    const [hover] = rulesListing('.app-nav-link-active:hover')
    for (const rule of [focus, hover]) {
      expect(declarationsOf(rule)).toEqual(['border-color: var(--app-accent-nav-focus-border)'])
      expect(declared(rule, 'border-color')).not.toBe(declared(selected, 'border-color'))
    }
  })

  // The focused border reads at 3:1 against the border it replaces and the surface it sits on, as the focus
  // colour does, and turns darker in the light theme and lighter in the dark one
  describe.each(['light', 'dark'] as const)('selected menu item focus border in the %s theme', (theme) => {
    const focusBorder = resolveColour('var(--app-accent-nav-focus-border)', theme).rgb
    const surfaces = ['--app-nav-bg', '--app-bg', '--app-surface-soft'].map((name) => ({
      name,
      rgb: resolveColour(`var(${name})`, theme).rgb,
    }))

    it.each(surfaces)('reads at 3:1 or better against the resting border and $name', ({ rgb }) => {
      const fill = resolveColour('var(--app-accent-soft)', theme)
      const border = resolveColour('var(--app-accent-border)', theme)
      const resting = paint(border.rgb, border.alpha, paint(fill.rgb, fill.alpha, rgb))
      expect(contrast(focusBorder, resting)).toBeGreaterThanOrEqual(3)
      expect(contrast(focusBorder, rgb)).toBeGreaterThanOrEqual(3)
    })

    it('moves away from the surface, darker in the light theme and lighter in the dark one', () => {
      const surface = resolveColour('var(--app-bg)', theme).rgb
      const sum = (colour: Rgb) => colour[0] + colour[1] + colour[2]
      expect(Math.sign(sum(focusBorder) - sum(surface))).toBe(theme === 'light' ? -1 : 1)
    })
  })

  // A filled button's hover fill used to land on the same colour as its rest fill in the light theme, so
  // keyboard focus, which now shows only the hover look, couldn't be seen
  for (const theme of ['light', 'dark'] as const) {
    for (const name of FILLED_BUTTONS) {
      it(`changes ${name}'s fill visibly under the pointer and on keyboard focus in the ${theme} theme`, () => {
        const [rest] = rulesListing(name)
        const [hover] = rulesListing(`${guarded(name)}:focus-visible`)
        const page = resolveColour('var(--app-bg)', theme).rgb
        const onPage = (rule: Rule) => {
          const fill = resolveColour(declared(rule, 'background')!, theme)
          return paint(fill.rgb, fill.alpha, page)
        }
        expect(contrast(onPage(rest), onPage(hover))).toBeGreaterThanOrEqual(MIN_FILL_CHANGE)
      })
    }
  }

  // A button unavailable for a reason stays hoverable and focusable, so it must show neither the pointer
  // look nor the press, and must read as off without fading its focus ring
  describe('button unavailable for a reason', () => {
    for (const name of FILLED_BUTTONS) {
      it(`keeps ${name} from changing under the pointer`, () => {
        const hover = rulesListing(`${guarded(name)}:hover`)
        expect(hover.length).toBeGreaterThan(0)
        expect(rulesListing(`${name}:hover`)).toHaveLength(0)
      })
    }

    for (const name of REASON_GUARDED) {
      it(`keeps ${name} from sinking when pressed`, () => {
        expect(rulesListing(`${guarded(name)}:active`).length).toBeGreaterThan(0)
        expect(rulesListing(`${name}:active`)).toHaveLength(0)
      })

      it(`dims ${name} through its own colours and not through opacity, which would fade the focus ring`, () => {
        const dimming: Rule[] = []
        stylesheet.walkRules((rule) => {
          const [selector] = selectorsOf(rule)
          if (
            selectorsOf(rule).length === 1 &&
            selector.includes(name) &&
            selector.endsWith('[aria-disabled="true"]') &&
            !selector.includes(':not(')
          )
            dimming.push(rule)
        })
        const colours = dimming.filter((rule) => declared(rule, 'background') !== undefined)
        expect(colours.length).toBeGreaterThan(0)
        for (const rule of dimming) expect(declared(rule, 'opacity')).toBeUndefined()
        for (const rule of colours) {
          expect(declared(rule, 'color')).toBeDefined()
          expect(declared(rule, 'border-color')).toBeDefined()
        }
        // The look that says unavailable
        expect(dimming.some((rule) => declared(rule, 'cursor') === 'not-allowed')).toBe(true)
      })
    }

    for (const theme of ['light', 'dark'] as const) {
      it(`draws a focus ring that reaches 3:1 against the page in the ${theme} theme`, () => {
        const ring = resolveColour('var(--app-focus-ring)', theme).rgb
        const page = resolveColour('var(--app-bg)', theme).rgb
        expect(contrast(ring, page)).toBeGreaterThanOrEqual(3)
      })
    }

    it('draws the ring on a focused one with no fade of its own', () => {
      const [rule] = rulesListing('button[aria-disabled="true"]:not(.app-dropdown-head):focus-visible')
      expect(rule).toBeDefined()
      expect(declared(rule, 'outline')).toBe('var(--app-focus-outline)')
      expect(declared(rule, 'opacity')).toBeUndefined()
    })

    it('keeps a focused dropdown dimmed without fading its ring', () => {
      const [box] = rulesListing('.app-dropdown-glass.app-dropdown-glass-disabled:focus-within')
      expect(box).toBeDefined()
      // The box keeps its ring at full strength and dims through the alpha of its fill
      expect(declared(box, 'opacity')).toBe('1')
      expect(declared(box, 'border-color')).toBe('var(--app-focus-ring)')
      expect(declared(box, 'background')).toContain('color-mix(in srgb, var(--app-dropdown-bg) 50%, transparent)')
      // What sits inside it carries no ring, so that fades
      const [head] = rulesListing('.app-dropdown-glass.app-dropdown-glass-disabled:focus-within .app-dropdown-head')
      expect(head).toBeDefined()
      expect(declared(head, 'opacity')).toBe('var(--app-dropdown-disabled-opacity-control)')
      // The fill, the ring and the content move together, over the app's duration and curve, since the ring
      // here is the box's own border and shadow rather than an outline
      const [time, easing] = ['var(--app-ease-duration)', 'var(--app-ease-curve)']
      const restBox = rulesListing('.app-dropdown-glass.app-dropdown-glass-disabled').find(
        (rule) => declared(rule, 'transition') !== undefined,
      )
      const restHead = rulesListing('.app-dropdown-glass-disabled .app-dropdown-head').find(
        (rule) => declared(rule, 'transition') !== undefined,
      )
      expect(time).toBeDefined()
      expect(easing).toBeDefined()
      expect(restBox).toBeDefined()
      expect(restHead).toBeDefined()
      for (const property of ['border-color', 'background', 'box-shadow', 'opacity']) {
        expect(declared(restBox!, 'transition')).toContain(`${property} ${time} ${easing}`)
      }
      expect(declared(restHead!, 'transition')).toBe(`opacity ${time} ${easing}`)
      // Reduced motion turns the move off, for the box and for its content
      for (const selector of [
        '.app-dropdown-glass.app-dropdown-glass-disabled',
        '.app-dropdown-glass-disabled .app-dropdown-head',
      ]) {
        const still = rulesListing(selector).filter(
          (rule) =>
            rule.parent instanceof AtRule &&
            /prefers-reduced-motion:\s*reduce/.test(rule.parent.params) &&
            declared(rule, 'transition') === 'none',
        )
        expect(still).toHaveLength(1)
      }
      // A finished import's answers read at full strength, focused or not
      const [recordBox] = rulesListing('.import-record .app-dropdown-glass.app-dropdown-glass-disabled:focus-within')
      const [recordHead] = rulesListing(
        '.import-record .app-dropdown-glass.app-dropdown-glass-disabled:focus-within .app-dropdown-head',
      )
      expect(declared(recordBox, 'background')).toBe('var(--app-dropdown-bg)')
      expect(declared(recordHead, 'opacity')).toBe('1')
    })
  })

  // A control with a border of its own shows its hover look and no ring, since a second outline would sit
  // around the border it already has, and a menu item counts as one since its hover look adds a border.
  // Every other button, filled buttons included, keeps the base ring on top of its hover look
  describe('ring', () => {
    const optOut = rulesListing(
      ':is(a, button, [role="button"], [role="tab"], [role="radio"], [role="menuitem"]):is(.app-secondary-button, .app-glass-button, .app-glass-icon-button, .app-expanding-button, .app-range-glass-head, .app-card, .app-nav-link, .app-nav-user-logout, .app-desktop-nav-toggle, .border:not(.border-transparent)):not(svg *):not([aria-disabled="true"]):focus-visible',
    )

    it('is dropped only from buttons that draw a border of their own', () => {
      expect(optOut).toHaveLength(1)
      expect(optOut[0].nodes.map((node) => node.toString())).toEqual(['outline: none'])
    })

    // The filled buttons, the icon button and the segmented options have no border at
    // rest, so no rule of their own may switch the ring off
    const BORDERLESS = [
      ...FILLED_BUTTONS,
      '.app-icon-button',
      '.app-segmented-option',
      '.app-segmented-option-active',
      '.app-calendar-day',
      '.app-range-apply',
    ]
    for (const name of BORDERLESS) {
      it(`keeps the ring on ${name} reached by keyboard`, () => {
        const focusRules = rulesListing(`${guarded(name)}:focus-visible`)
        expect(focusRules.length).toBeGreaterThan(0)
        for (const rule of focusRules) {
          expect(rule.nodes.some((node) => node.type === 'decl' && /^outline/.test(node.prop))).toBe(false)
        }
        expect(selectorsOf(optOut[0])[0]).not.toContain(name)
      })
    }

    it('lists the bordered shared classes the ring is dropped from, each with a border at rest', () => {
      for (const name of BORDER_CHANGING) {
        expect(selectorsOf(optOut[0])[0]).toContain(name)
        const [rest] = rulesListing(name)
        expect(borderColourOf(rest) ?? declared(rest, 'border-color')).toBeDefined()
      }
    })

    // Every compact segmented control clips its indicator with 2px of padding, so its options take the
    // ring against their edge instead of the base gap. The time selector and the balance chart view
    // selector are two of them
    it('moves the ring of every compact segmented control against its option', () => {
      const compact = rulesListing('.app-segmented-control-compact .app-segmented-option:focus-visible')
      expect(compact).toHaveLength(1)
      expect(declared(compact[0], 'outline-offset')).toBeDefined()
      expect(
        rulesListing('.app-time-selector .app-segmented-option:focus-visible').every(
          (rule) => declared(rule, 'outline-offset') === undefined,
        ),
      ).toBe(true)
    })
  })

  // A toggle switch's track has no border, so it takes the ring around the whole switch, and its fill, off
  // or on, turns stronger under the pointer and on keyboard focus. Its fill used to stay as it was
  describe('toggle switch', () => {
    const hover = rulesListing('label:hover .app-switch-input:not(:disabled) + .app-switch-track')
    const focus = rulesListing('.app-switch-input:focus-visible + .app-switch-track')

    it('takes the same stronger fill under the pointer, on a touch screen never, and on keyboard focus', () => {
      expect(hover).toHaveLength(1)
      expect(focus).toHaveLength(1)
      expect(isHoverOnlyMedia(hover[0])).toBe(true)
      expect(declarationsOf(focus[0])).toEqual(declarationsOf(hover[0]))
    })

    it('draws the shared ring around the switch, and nothing on the track itself', () => {
      const [ring] = rulesListing('.app-switch:has(> .app-switch-input:focus-visible)')
      expect(declared(ring, 'outline')).toBe('var(--app-focus-outline)')
      expect(
        focus.concat(rulesListing('.app-switch-track')).some((rule) => declared(rule, 'outline') !== undefined),
      ).toBe(false)
    })

    for (const theme of ['light', 'dark'] as const) {
      for (const state of ['off', 'on'] as const) {
        it(`changes the ${state} track's fill visibly under the pointer and on keyboard focus in the ${theme} theme`, () => {
          const [track] = rulesListing('.app-switch-track')
          const card = resolveColour('var(--app-surface-soft)', theme).rgb
          const onCard = (value: string) => {
            const fill = resolveColour(value, theme)
            return paint(fill.rgb, fill.alpha, card)
          }
          const rest = declared(track, `--app-switch-${state}`)!
          const hovered = declared(focus[0], `--app-switch-${state}`)!
          expect(contrast(onCard(rest), onCard(hovered))).toBeGreaterThanOrEqual(MIN_SWITCH_CHANGE)
        })
      }
    }
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
