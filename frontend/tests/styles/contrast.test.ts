/**
 * Guards text contrast computed from the stylesheet's colour tokens, so a token change can't leave a
 * label below the WCAG AA minimum for normal text in either theme
 */
import { readFileSync } from 'node:fs'
import { parse, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { FX_TONE_CLASS } from '@/components/tooltips/fxToneClass'

// WCAG AA for text under 18.66px bold or 24px regular, which covers every label this file checks
const MINIMUM_TEXT_CONTRAST = 4.5

type Rgb = [number, number, number]
type Theme = 'light' | 'dark'
type Tokens = Record<string, string>

const stylesheet = parse(readFileSync(new URL('../../src/styles/tailwind.css', import.meta.url), 'utf8'))

function readTokens(selector: string): Tokens {
  const tokens: Tokens = {}
  stylesheet.walkRules((rule: Rule) => {
    if (rule.selector !== selector) return
    rule.walkDecls(/^--app-/, (declaration) => {
      tokens[declaration.prop] ??= declaration.value
    })
  })
  return tokens
}

const lightTokens = readTokens(':root')
const THEMES: Record<Theme, Tokens> = { light: lightTokens, dark: { ...lightTokens, ...readTokens('.dark') } }

function readHex(tokens: Tokens, name: string): { rgb: Rgb; alpha: number } {
  const value = tokens[name]
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value ?? '')
  if (!match) throw new Error(`${name} is not a hex colour: ${value}`)

  const [red, green, blue] = [0, 2, 4].map((start) => parseInt(match[1].slice(start, start + 2), 16))
  return { rgb: [red, green, blue], alpha: match[2] ? parseInt(match[2], 16) / 255 : 1 }
}

/** Paints a colour at the given opacity over an opaque backdrop, the way the browser composites it */
function paint(color: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return color.map((channel, index) => channel * alpha + backdrop[index] * (1 - alpha)) as Rgb
}

function solid(tokens: Tokens, name: string, backdrop?: Rgb): Rgb {
  const { rgb, alpha } = readHex(tokens, name)
  if (alpha < 1 && !backdrop) throw new Error(`${name} is translucent and needs a backdrop`)
  return backdrop ? paint(rgb, alpha, backdrop) : rgb
}

function luminance(color: Rgb) {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(text: Rgb, surface: Rgb) {
  const [lighter, darker] = [luminance(text), luminance(surface)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

// The plain surfaces text sits on: the page, a card, and the tinted inset the Imports page draws its
// panels in (IMPORT_INSET_STYLE, 58% of the input fill over the page). State tints laid over them, such
// as a field in error or a chosen dropdown row, are checked under tinted state contrast below
function surfaces(tokens: Tokens): Record<string, Rgb> {
  const page = solid(tokens, '--app-bg')
  return {
    page,
    card: solid(tokens, '--app-surface-soft'),
    'import panel': paint(solid(tokens, '--app-input-bg'), 0.58, page),
  }
}

describe('secondary button label contrast', () => {
  // The button's fill is 62% of the input fill over whatever it sits on (.app-secondary-button)
  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) =>
    Object.entries(surfaces(THEMES[theme])).map(([surface, backdrop]) => ({ theme, surface, backdrop })))

  it.each(cases)('reads at 4.5:1 or better in the $theme theme on the $surface', ({ theme, backdrop }) => {
    const tokens = THEMES[theme]
    const fill = paint(solid(tokens, '--app-input-bg'), 0.62, backdrop)
    expect(contrast(solid(tokens, '--app-text-muted'), fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })
})

describe('text colour contrast', () => {
  const TEXT_TOKENS = ['--app-text', '--app-text-muted', '--app-text-subtle', '--app-accent']

  // Text also sits directly on a field, as placeholders, money prefixes and an open dropdown's panel do
  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => {
    const tokens = THEMES[theme]
    const backdrops = { ...surfaces(tokens), field: solid(tokens, '--app-input-bg') }
    return TEXT_TOKENS.flatMap((token) =>
      Object.entries(backdrops).map(([surface, backdrop]) => ({ theme, token, surface, backdrop })))
  })

  it.each(cases)('$token reads at 4.5:1 or better in the $theme theme on the $surface', ({ theme, token, backdrop }) => {
    expect(contrast(solid(THEMES[theme], token), backdrop)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })

  // Subtle text is the quieter of the two secondary levels, so raising it must not overtake muted
  it.each(Object.keys(THEMES) as Theme[])('keeps subtle text quieter than muted text in the %s theme', (theme) => {
    const tokens = THEMES[theme]
    const page = solid(tokens, '--app-bg')
    expect(contrast(solid(tokens, '--app-text-subtle'), page)).toBeLessThan(contrast(solid(tokens, '--app-text-muted'), page))
  })
})

/** Mixes two opaque colours the way color-mix in srgb does, with the given share of the first */
function mix(first: Rgb, share: number, second: Rgb): Rgb {
  return paint(first, share, second)
}

/** Reads an opaque colour token written as a hex value, another token, or a color-mix of two tokens */
function resolve(tokens: Tokens, name: string): Rgb {
  const value = tokens[name] ?? ''
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  if (alias) return resolve(tokens, alias[1])
  const mixed = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, var\((--[\w-]+)\)\)$/.exec(value)
  if (mixed) return mix(resolve(tokens, mixed[1]), Number(mixed[2]) / 100, resolve(tokens, mixed[3]))
  return solid(tokens, name)
}

/** Paints a wash token written as a share of a token into transparent, over an opaque backdrop */
function washOver(tokens: Tokens, name: string, backdrop: Rgb): Rgb {
  const value = tokens[name] ?? ''
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  if (alias) return washOver(tokens, alias[1], backdrop)
  if (/^#/.test(value)) return solid(tokens, name, backdrop)
  const wash = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, transparent\)$/.exec(value)
  if (!wash) throw new Error(`${name} is not a wash of a token: ${value}`)
  return paint(resolve(tokens, wash[1]), Number(wash[2]) / 100, backdrop)
}

describe('primary button label contrast', () => {
  // The fill is 82% of the button colour at rest and 88% of the hover colour over whatever it sits on
  // (.app-primary-button and .app-glass-button-primary). A dialog's panel is the page colour
  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => {
    const tokens = THEMES[theme]
    const backdrops = { ...surfaces(tokens), field: solid(tokens, '--app-input-bg') }
    return (['rest', 'hover'] as const).flatMap((state) =>
      Object.entries(backdrops).map(([surface, backdrop]) => ({ theme, state, surface, backdrop })))
  })

  it.each(cases)('reads at 4.5:1 or better in the $theme theme at $state on the $surface', ({ theme, state, backdrop }) => {
    const tokens = THEMES[theme]
    const fill = state === 'rest'
      ? paint(solid(tokens, '--app-button-primary-bg'), 0.82, backdrop)
      : paint(solid(tokens, '--app-button-primary-bg-hover'), 0.88, backdrop)
    expect(contrast(solid(tokens, '--app-button-primary-text'), fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })
})

describe('tinted state contrast', () => {
  // Each state lays a tint over the surface it sits on, so the text in it is read against both together
  type State = { name: string; text: string[]; fill: (tokens: Tokens) => Rgb }
  const STATES: State[] = [
    {
      // RUNWAY_BAND_STYLE, each badge on the field-coloured row of the runway settings
      name: 'the Healthy runway badge',
      text: ['--app-positive'],
      fill: (tokens) => solid(tokens, '--app-positive-soft', solid(tokens, '--app-input-bg')),
    },
    {
      name: 'the Low runway badge',
      text: ['--app-accent'],
      fill: (tokens) => solid(tokens, '--app-accent-soft', solid(tokens, '--app-input-bg')),
    },
    {
      name: 'the Risky runway badge',
      text: ['--app-negative'],
      fill: (tokens) => solid(tokens, '--app-negative-soft', solid(tokens, '--app-input-bg')),
    },
    {
      // ArchiveBalanceWarning, inside the account dialog, whose panel is the page colour
      name: 'the archive warning',
      text: ['--app-text', '--app-text-muted-on-warning'],
      fill: (tokens) => solid(tokens, '--app-warning-soft', solid(tokens, '--app-bg')),
    },
    {
      // .app-input-error, a field in a dialog, whose placeholder and money prefix step up to muted
      name: 'a field in error',
      text: ['--app-text', '--app-text-muted'],
      fill: (tokens) => solid(tokens, '--app-negative-soft', solid(tokens, '--app-bg')),
    },
    {
      // .app-dropdown-row-highlighted, 6% of the text colour over the open list's field-coloured panel
      name: 'a highlighted dropdown row',
      text: ['--app-text', '--app-text-muted'],
      fill: (tokens) => paint(solid(tokens, '--app-text'), 0.06, solid(tokens, '--app-input-bg')),
    },
    {
      // .app-dropdown-row-selected, 6% of the accent over the open list's field-coloured panel. A highlighted or
      // chosen row draws faint text such as an option's description in muted
      name: 'the chosen dropdown row',
      text: ['--app-accent', '--app-text-muted'],
      fill: (tokens) => paint(solid(tokens, '--app-accent'), 0.06, solid(tokens, '--app-input-bg')),
    },
    {
      // .app-dropdown-row-selected.app-dropdown-row-highlighted, 10% of the accent over the panel
      name: 'the chosen dropdown row while highlighted',
      text: ['--app-accent', '--app-text-muted'],
      fill: (tokens) => paint(solid(tokens, '--app-accent'), 0.10, solid(tokens, '--app-input-bg')),
    },
    {
      // The budget details panel and a hovered tax-advantaged limit row, both drawn in a dialog, whose panel is the
      // page colour
      name: 'the accent tint in a dialog',
      text: ['--app-text-subtle-on-accent', '--app-text-muted'],
      fill: (tokens) => solid(tokens, '--app-accent-soft', solid(tokens, '--app-bg')),
    },
    {
      // The Imports upload card under the pointer (.app-upload-card), which draws its title in the text colour, its
      // hint in subtle text, and a refusal in red. Its fill is the shared hover colour, which is a wash in the dark theme
      name: 'the upload card under the pointer',
      text: ['--app-text', '--app-text-subtle', '--app-negative'],
      fill: (tokens) => washOver(tokens, '--app-hover-soft', surfaces(tokens).page),
    },
    {
      // IMPORT_EXCLUDED_ROW_BACKGROUND, 12% of the text colour into the page, whose faint text is drawn in muted
      name: 'an excluded Imports row',
      text: ['--app-text-muted'],
      fill: (tokens) => mix(solid(tokens, '--app-bg'), 0.88, solid(tokens, '--app-text')),
    },
  ]

  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) =>
    STATES.flatMap((state) => state.text.map((token) => ({ theme, token, state: state.name, fill: state.fill }))))

  it.each(cases)('$token reads at 4.5:1 or better on $state in the $theme theme', ({ theme, token, fill }) => {
    const tokens = THEMES[theme]
    const text = resolve(tokens, token)
    expect(contrast(text, fill(tokens))).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })

  // Faint text on the accent tint steps up from subtle toward muted, so each theme reads better there than
  // subtle did, but it must stay the quieter of the two
  it.each(Object.keys(THEMES) as Theme[])('puts faint text on the accent tint between subtle and muted text in the %s theme', (theme) => {
    const tokens = THEMES[theme]
    const tint = solid(tokens, '--app-accent-soft', solid(tokens, '--app-bg'))
    const faint = contrast(resolve(tokens, '--app-text-subtle-on-accent'), tint)
    expect(faint).toBeGreaterThan(contrast(solid(tokens, '--app-text-subtle'), tint))
    expect(faint).toBeLessThan(contrast(solid(tokens, '--app-text-muted'), tint))
  })
})

describe('FX status badge label contrast', () => {
  // Reads the colours the badge's real idle classes (FX_TONE_CLASS) draw: the label colour, the fill's colour
  // and share mixed into the page, a transparent fill, and any opacity on the whole badge
  const OWN = (classes: string) => classes.split(/\s+/).filter((name) => !name.includes(':'))

  function readColour(tokens: Tokens, value: string): Rgb {
    if (value === 'white') return [255, 255, 255]
    const alias = /^var\((--[\w-]+)\)$/.exec(value)
    if (alias) return resolve(tokens, alias[1])
    const hex = /^#([0-9a-f]{6})$/i.exec(value)
    if (!hex) throw new Error(`cannot read colour ${value}`)
    return [0, 2, 4].map((start) => parseInt(hex[1].slice(start, start + 2), 16)) as Rgb
  }

  /** The label and fill as they land on a backdrop, the whole badge faded by its opacity */
  function paintBadge(idle: string, tokens: Tokens, backdrop: Rgb) {
    const names = OWN(idle)
    const text = /^text-\[(.+)\]$/.exec(names.find((name) => name.startsWith('text-['))!)![1]
    const fill = names.find((name) => name.startsWith('bg-'))!
    const mixed = /^bg-\[color-mix\(in_srgb,(.+)_(\d+)%,var\(--app-bg\)\)\]$/.exec(fill)
    const opacity = /^opacity-(\d+)$/.exec(names.find((name) => name.startsWith('opacity-')) ?? '')
    const faded = opacity ? Number(opacity[1]) / 100 : 1

    if (!mixed && fill !== 'bg-transparent') throw new Error(`cannot read fill ${fill}`)
    const surface = mixed
      ? mix(readColour(tokens, mixed[1]), Number(mixed[2]) / 100, solid(tokens, '--app-bg'))
      : backdrop
    return {
      label: paint(readColour(tokens, text), faded, backdrop),
      fill: paint(surface, faded, backdrop),
    }
  }

  // A faded or transparent badge shows what it sits on, so each is read on the page, a card and the budget
  // details panel's tint. The red cases guard a state that already passed and must stay so
  const BADGES = [
    { state: 'complete conversion (blue)', tone: 'blue' as const },
    { state: 'no conversion needed (gray)', tone: 'gray' as const },
    { state: 'missing rates (red)', tone: 'red' as const },
  ]

  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => BADGES.flatMap((badge) =>
    ['page', 'card', 'details panel'].map((surface) => ({ theme, surface, ...badge }))))

  it.each(cases)('the $state badge label reads at 4.5:1 or better in the $theme theme on the $surface', ({ theme, tone, surface }) => {
    const tokens = THEMES[theme]
    const backdrops: Record<string, Rgb> = {
      page: solid(tokens, '--app-bg'),
      card: solid(tokens, '--app-surface-soft'),
      'details panel': solid(tokens, '--app-accent-soft', solid(tokens, '--app-bg')),
    }
    const { label, fill } = paintBadge(FX_TONE_CLASS[tone].idle, tokens, backdrops[surface])
    expect(contrast(label, fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })

  // Hovered, the idle classes' group-hover variants draw the label on a solid fill, and open, the active
  // classes do, so neither depends on what the badge sits on
  const FILLED_STATES = {
    hovered: (tone: keyof typeof FX_TONE_CLASS) => FX_TONE_CLASS[tone].idle.split(/\s+/)
      .filter((name) => name.startsWith('group-hover:')).map((name) => name.slice('group-hover:'.length)),
    open: (tone: keyof typeof FX_TONE_CLASS) => OWN(FX_TONE_CLASS[tone].active),
  }

  const filledCases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => BADGES.flatMap((badge) =>
    (Object.keys(FILLED_STATES) as (keyof typeof FILLED_STATES)[]).map((state) => ({ theme, filled: state, ...badge }))))

  it.each(filledCases)('the $state badge label reads at 4.5:1 or better $filled in the $theme theme', ({ theme, tone, filled }) => {
    const tokens = THEMES[theme]
    const names = FILLED_STATES[filled](tone)
    const text = /^text-(?:\[(.+)\]|(white))$/.exec(names.find((name) => name.startsWith('text-'))!)!
    const fill = /^bg-\[(.+)\]$/.exec(names.find((name) => name.startsWith('bg-'))!)!
    expect(contrast(readColour(tokens, text[1] ?? text[2]), readColour(tokens, fill[1]))).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })
})

describe('avatar initials contrast', () => {
  // The initials sit on a gradient from the first stop to the last, and contrast moves steadily along the
  // blend, so the two stops bound it
  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) =>
    ['--app-avatar-start', '--app-avatar-end'].map((stop) => ({ theme, stop })))

  it.each(cases)('the initials read at 4.5:1 or better in the $theme theme on the gradient\'s $stop stop', ({ theme, stop }) => {
    const tokens = THEMES[theme]
    expect(contrast(solid(tokens, '--app-avatar-text'), solid(tokens, stop))).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })
})
