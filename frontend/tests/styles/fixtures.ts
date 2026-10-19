import { readFileSync } from 'node:fs'
import { parse, type Rule } from 'postcss'

export type Rgb = [number, number, number]
export type Theme = 'light' | 'dark'
export type Tokens = Record<string, string>

export const stylesheet = parse(readFileSync(new URL('../../src/styles/tailwind.css', import.meta.url), 'utf8'))

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

/** Each theme's colour tokens, the dark theme's laid over the light ones it doesn't redefine */
export const THEMES: Record<Theme, Tokens> = { light: lightTokens, dark: { ...lightTokens, ...readTokens('.dark') } }

/** Paints a colour at the given opacity over an opaque backdrop, the way the browser composites it */
export function paint(color: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return color.map((channel, index) => channel * alpha + backdrop[index] * (1 - alpha)) as Rgb
}

function luminance(color: Rgb) {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** The WCAG contrast ratio between two opaque colours */
export function contrast(first: Rgb, second: Rgb) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}
