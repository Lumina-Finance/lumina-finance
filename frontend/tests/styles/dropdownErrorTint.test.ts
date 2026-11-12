/**
 * Guards a rejected dropdown tinting its whole box when it opens, as it does shut, so the shared
 * dropdown looks the same on every screen. A rule aimed at the floating, rejected box would tint
 * only its head and leave the list on the plain background.
 */
import type { Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { stylesheet } from './fixtures'

describe('rejected dropdown tint', () => {
  it('has no rule of its own for the open box, so the tint covers the whole box', () => {
    const selectors: string[] = []
    stylesheet.walkRules((rule: Rule) => {
      if (
        /\.app-dropdown-glass-floating(?!\))/.test(rule.selector) &&
        rule.selector.includes('app-dropdown-glass-error')
      ) {
        selectors.push(rule.selector)
      }
    })

    expect(selectors).toEqual([])
  })

  it('tints the box through the one background token the head and list both draw from', () => {
    let tint = ''
    stylesheet.walkRules('.app-dropdown-glass.app-dropdown-glass-error', (rule) => {
      rule.walkDecls('--app-dropdown-bg', (declaration) => {
        tint = declaration.value
      })
    })

    expect(tint).toContain('var(--app-negative)')
  })
})
