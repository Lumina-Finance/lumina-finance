/**
 * Keeps the upload card's hover and focus look easing in and out on the app's ease-out curve over long enough to
 * see. An ease-out over 150ms finishes most of a small colour change in its first frames, so the card's fill,
 * border and hint take the app's default 300ms for that curve, and none of it runs under reduced motion
 */
import type { AtRule, Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { stylesheet } from './fixtures'

const APP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const MINIMUM_VISIBLE_MS = 300

/** Splits a transition value at its top-level commas, keeping cubic-bezier's own commas together */
function splitTransitions(value: string): string[] {
  return value.split(/,\s*(?![^()]*\))/).map((entry) => entry.trim())
}

/** The transition entries a selector's rules outside any at-rule declare, keyed by the property they ease */
function transitionsOf(selector: string): Map<string, string> {
  const entries = new Map<string, string>()
  stylesheet.walkRules(selector, (rule: Rule) => {
    if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'media') return
    rule.walkDecls('transition', (declaration) => {
      for (const entry of splitTransitions(declaration.value)) entries.set(entry.split(/\s+/)[0], entry)
    })
  })
  return entries
}

/** The milliseconds an entry such as `background-color 250ms cubic-bezier(...)` runs for */
function durationOf(entry: string): number {
  const match = entry.match(/\s(\d*\.?\d+)(ms|s)\s/)
  if (!match) throw new Error(`No duration in ${entry}`)
  return Number(match[1]) * (match[2] === 's' ? 1000 : 1)
}

describe('upload card hover easing', () => {
  it.each([
    ['.app-upload-card', 'background-color'],
    ['.app-upload-card', 'border-color'],
    ['.app-upload-card-hint', 'color'],
  ])('%s eases its %s on the app curve over at least 300ms', (selector, property) => {
    const entry = transitionsOf(selector).get(property)
    expect(entry, `${selector} names no ${property} transition, so its hover would snap`).toBeDefined()
    expect(entry).toContain(APP_EASE)
    expect(durationOf(entry!)).toBeGreaterThanOrEqual(MINIMUM_VISIBLE_MS)
  })

  it('takes the focus ring fade and the press on the card as well', () => {
    const entries = transitionsOf('.app-upload-card')
    expect(entries.has('transform')).toBe(true)
    expect(entries.has('var(--app-focus-fade)')).toBe(true)
  })

  it('shows its hover fill through the hover rule that outranks the inline rest fill', () => {
    const colours: string[] = []
    stylesheet.walkRules((rule: Rule) => {
      if (!rule.selector.includes('.app-upload-card:not([aria-disabled="true"]):hover') || rule.selector.includes('hint')) return
      rule.walkDecls('background-color', (declaration) => colours.push(`${declaration.value}${declaration.important ? ' !important' : ''}`))
    })
    expect(colours).toEqual(['var(--app-hover-on-import-panel) !important'])
  })

  it('stops easing the card and its hint under reduced motion', () => {
    const stopped: string[] = []
    stylesheet.walkAtRules('media', (media: AtRule) => {
      if (!media.params.includes('prefers-reduced-motion: reduce')) return
      media.walkRules((rule: Rule) => {
        if (!rule.selector.includes('.app-upload-card')) return
        rule.walkDecls('transition', (declaration) => {
          if (declaration.value === 'none') stopped.push(...rule.selectors.map((selector) => selector.trim()))
        })
      })
    })
    expect(stopped).toEqual(expect.arrayContaining(['.app-upload-card', '.app-upload-card-hint']))
  })
})
