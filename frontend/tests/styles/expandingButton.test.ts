/**
 * Guards the icon that grows into a labelled button. Hover alone would leave keyboard and touch users
 * with an unlabelled icon, so the label must grow on keyboard focus and rest grown where nothing hovers
 */
import { AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { stylesheet } from './fixtures'

const LABEL = '.app-expanding-button-label'

function labelIsShownBy(rule: Rule) {
  let shown = false
  rule.walkDecls('grid-template-columns', (declaration) => {
    shown ||= declaration.value === '1fr'
  })
  return shown
}

describe('expanding button', () => {
  it('grows its label on hover and on keyboard focus together', () => {
    const selectors: string[] = []
    stylesheet.walkRules((rule) => {
      if (rule.parent?.type === 'atrule' && (rule.parent as AtRule).name === 'media') return
      if (labelIsShownBy(rule)) selectors.push(rule.selector)
    })

    expect(selectors.join(' ')).toContain('.app-expanding-button:hover ' + LABEL)
    expect(selectors.join(' ')).toContain('.app-expanding-button:focus-visible ' + LABEL)
  })

  it('rests grown where the device cannot hover', () => {
    let grownWithoutHover = false
    stylesheet.walkAtRules('media', (atRule) => {
      if (!atRule.params.includes('hover: none')) return
      atRule.walkRules(LABEL, (rule) => {
        grownWithoutHover ||= labelIsShownBy(rule)
      })
    })

    expect(grownWithoutHover).toBe(true)
  })
})
