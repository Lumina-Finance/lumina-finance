/**
 * Guards text contrast computed from the stylesheet's colour tokens, so a token change can't leave a
 * label below the WCAG AA minimum for normal text in either theme
 */
import { describe, expect, it } from 'vitest'
import { FX_TONE_CLASS } from '@/components/tooltips/fxToneClass'
import { contrast, paint, stylesheet, THEMES, type Rgb, type Theme, type Tokens } from './fixtures'

// WCAG AA for text under 18.66px bold or 24px regular, which covers every label this file checks
const MINIMUM_TEXT_CONTRAST = 4.5

function readHex(tokens: Tokens, name: string): { rgb: Rgb; alpha: number } {
  const value = tokens[name]
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value ?? '')
  if (!match) throw new Error(`${name} is not a hex colour: ${value}`)

  const [red, green, blue] = [0, 2, 4].map((start) => parseInt(match[1].slice(start, start + 2), 16))
  return { rgb: [red, green, blue], alpha: match[2] ? parseInt(match[2], 16) / 255 : 1 }
}

function solid(tokens: Tokens, name: string, backdrop?: Rgb): Rgb {
  const { rgb, alpha } = readHex(tokens, name)
  if (alpha < 1 && !backdrop) throw new Error(`${name} is translucent and needs a backdrop`)
  return backdrop ? paint(rgb, alpha, backdrop) : rgb
}

// The plain surfaces text sits on: the page, a card, and the tinted inset the Imports page draws its
// panels in (IMPORT_INSET_STYLE, 58% of the input fill over the page). State tints laid over them, such
// as a field in error or a chosen dropdown row, are checked under tinted state contrast below
function surfaces(tokens: Tokens): Record<string, Rgb> {
  const page = solid(tokens, '--app-bg')
  return {
    page,
    card: solid(tokens, '--app-surface-soft'),
    'import panel': resolve(tokens, '--app-import-panel'),
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
  const mixed = /^color-mix\(in srgb, var\((--[\w-]+)\) ([\d.]+)%, var\((--[\w-]+)\)\)$/.exec(value)
  if (mixed) return mix(resolve(tokens, mixed[1]), Number(mixed[2]) / 100, resolve(tokens, mixed[3]))
  const darkened = /^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%, black\)$/.exec(value)
  if (darkened) return mix(resolve(tokens, darkened[1]), Number(darkened[2]) / 100, [0, 0, 0])
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

describe('danger button label contrast', () => {
  // The white label sits on 82% of the danger fill at rest and 90% of its darker hover fill over whatever it
  // sits on (.app-danger-button). A lighter hover red would take the label under the minimum in the dark theme
  const WHITE: Rgb = [255, 255, 255]
  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => {
    const tokens = THEMES[theme]
    const backdrops = { ...surfaces(tokens), field: solid(tokens, '--app-input-bg') }
    return (['rest', 'hover'] as const).flatMap((state) =>
      Object.entries(backdrops).map(([surface, backdrop]) => ({ theme, state, surface, backdrop })))
  })

  it.each(cases)('reads at 4.5:1 or better in the $theme theme at $state on the $surface', ({ theme, state, backdrop }) => {
    const tokens = THEMES[theme]
    const fill = state === 'rest'
      ? paint(resolve(tokens, '--app-danger-fill'), 0.82, backdrop)
      : paint(resolve(tokens, '--app-danger-fill-hover'), 0.9, backdrop)
    expect(contrast(WHITE, fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })
})

describe('keyboard focus ring contrast', () => {
  // Controls without a border of their own draw the ring on the surface around them: the page, a card,
  // a field and the sidebar, and a transaction row draws it inside its own edge on its hover fill. A
  // selected option's tint is left out on purpose, since the time selector keeps its ring outside it
  const MINIMUM_RING_CONTRAST = 3
  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => {
    const tokens = THEMES[theme]
    const card = solid(tokens, '--app-surface-soft')
    const backdrops = {
      ...surfaces(tokens),
      field: solid(tokens, '--app-input-bg'),
      sidebar: solid(tokens, '--app-nav-bg'),
      // The Delete circle's confirmation panel in the Edit account window (DeletePanel)
      'delete panel': solid(tokens, '--app-negative-soft', card),
      'hovered row': theme === 'light' ? solid(tokens, '--app-hover-soft') : paint(solid(tokens, '--app-text'), 0.06, card),
    }
    return Object.entries(backdrops).map(([surface, backdrop]) => ({ theme, surface, backdrop }))
  })

  it.each(cases)('is 3:1 or better in the $theme theme on the $surface', ({ theme, backdrop }) => {
    expect(contrast(solid(THEMES[theme], '--app-focus-ring'), backdrop)).toBeGreaterThanOrEqual(MINIMUM_RING_CONTRAST)
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
      // hint in subtle text, and a refusal in red, on its own hover colour
      name: 'the upload card under the pointer',
      text: ['--app-text', '--app-text-subtle', '--app-negative'],
      fill: (tokens) => resolve(tokens, '--app-hover-on-import-panel'),
    },
    {
      // A day of a neighbouring month in the date picker (.app-calendar-day[data-outside]) under the pointer or keyboard
      // focus, drawn in the text colour over the accent tint on the picker's field-coloured panel
      name: 'a calendar day outside the month under the pointer',
      text: ['--app-text'],
      fill: (tokens) => solid(tokens, '--app-accent-soft', solid(tokens, '--app-input-bg')),
    },
    {
      // .app-nav-link under the pointer or keyboard focus, and the selected item at rest, in the main sidebar
      name: 'a menu item on the sidebar',
      text: ['--app-accent-nav-text'],
      fill: (tokens) => solid(tokens, '--app-accent-soft', solid(tokens, '--app-nav-bg')),
    },
    {
      // The same item in the settings sidebar, which sits on the page
      name: 'a menu item on the page',
      text: ['--app-accent-nav-text'],
      fill: (tokens) => solid(tokens, '--app-accent-soft', solid(tokens, '--app-bg')),
    },
    {
      // The same item in the phone's settings menu, which sits on the shaded surface
      name: 'a menu item on the shaded surface',
      text: ['--app-accent-nav-text'],
      fill: (tokens) => solid(tokens, '--app-accent-soft', solid(tokens, '--app-surface-soft')),
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

describe('selected row text on the page colour', () => {
  // A selected row of a list drawn straight on a dialog's page colour, such as the credit accounts list, takes
  // the accent tint over the page, with the darker accent text for its name, while its type and institution
  // keep the muted text
  it.each(Object.keys(THEMES) as Theme[])('reads at 4.5:1 or better in the %s theme', (theme) => {
    const tokens = THEMES[theme]
    const tint = solid(tokens, '--app-accent-soft', solid(tokens, '--app-bg'))
    expect(contrast(resolve(tokens, '--app-accent-on-page-tint'), tint)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
    expect(contrast(solid(tokens, '--app-text-muted', tint), tint)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })

  it('keeps the dark theme on the plain accent, which already passes', () => {
    expect(resolve(THEMES.dark, '--app-accent-on-page-tint')).toEqual(resolve(THEMES.dark, '--app-accent'))
  })
})

describe('a chosen checklist row under the pointer', () => {
  // MultiSelectChecklist: the row rests in the soft accent tint and takes the deeper hover fill with its own
  // text colour, on the dialog's page colour (the credit accounts list) or the filter panel's field colour. Its
  // type and institution line keeps the muted text
  const MINIMUM_STEP = 1.05
  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) =>
    (['page', 'field'] as const).map((surface) => ({ theme, surface })))

  it.each(cases)('reads at 4.5:1 and shows against its resting tint in the $theme theme on the $surface', ({ theme, surface }) => {
    const tokens = THEMES[theme]
    const backdrop = surface === 'page' ? solid(tokens, '--app-bg') : solid(tokens, '--app-input-bg')
    const fill = washOver(tokens, '--app-accent-chosen-hover-fill', backdrop)
    expect(contrast(resolve(tokens, '--app-accent-on-hover-fill'), fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
    // Only a list with details, which draws straight on the page colour, has the muted line
    if (surface === 'page') expect(contrast(solid(tokens, '--app-text-muted'), fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
    expect(contrast(fill, solid(tokens, '--app-accent-soft', backdrop))).toBeGreaterThanOrEqual(MINIMUM_STEP)
  })
})

describe('hover on shaded surfaces', () => {
  // The smallest step between a surface and the same surface under the pointer that shows, where the flat light
  // hover colour is 1.0 on the card and about 1.01 on the import panel
  const MINIMUM_HOVER_STEP = 1.05

  /** The token a rule's hover fill points at, which everything inside the rule takes under the pointer */
  function hoverFillOf(selector: string): string {
    let found: string | undefined
    stylesheet.walkRules(selector, (rule) => rule.walkDecls('--app-hover-fill', (declaration) => { found = declaration.value }))
    return /^var\((--[\w-]+)\)$/.exec(found ?? '')![1]
  }

  const SHADED = [
    { surface: 'card', token: hoverFillOf('.app-card'), backdrop: (tokens: Tokens) => solid(tokens, '--app-surface-soft') },
  ]

  const cases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => SHADED.map((shaded) => ({ theme, ...shaded })))

  it.each(cases)('shows against the $surface in the $theme theme', ({ theme, token, backdrop }) => {
    const tokens = THEMES[theme]
    expect(contrast(washOver(tokens, token, backdrop(tokens)), backdrop(tokens))).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })

  // The rows and toggles that take the menu items' accent hover (app-accent-hover) sit on the card and the import
  // panel, where the soft accent fill must step off the surface and carry text at 4.5:1
  const ACCENT_SURFACES = ['card', 'import panel'] as const
  const accentCases = (Object.keys(THEMES) as Theme[]).flatMap((theme) => ACCENT_SURFACES.map((surface) => ({ theme, surface })))

  it.each(accentCases)('shows the accent hover and reads on the $surface in the $theme theme', ({ theme, surface }) => {
    const tokens = THEMES[theme]
    const backdrop = surface === 'card' ? solid(tokens, '--app-surface-soft') : surfaces(tokens)['import panel']
    const fill = washOver(tokens, '--app-accent-soft', backdrop)
    expect(contrast(fill, backdrop)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
    expect(contrast(resolve(tokens, '--app-accent-nav-text'), fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
    // The Settings rows' count line, which sits on the card, steps to this quieter text so it still reads on the fill
    if (surface === 'card') {
      expect(contrast(resolve(tokens, '--app-text-subtle-on-accent'), fill)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
    }
  })

  it.each(Object.keys(THEMES) as Theme[])('shows the upload card under the pointer against the import panel in the %s theme', (theme) => {
    const tokens = THEMES[theme]
    expect(contrast(resolve(tokens, '--app-hover-on-import-panel'), resolve(tokens, '--app-import-panel'))).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })
})
