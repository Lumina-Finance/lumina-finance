/**
 * Tests the grouping settings the Group by panel and the phone's sheet both show, so each setting stays
 * labelled and starts from the value the page holds
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GroupingPanelBody, type AccountGroupingSettings } from '@/pages/accounts/components/toolbar/GroupingPanel'

const noop = () => {}

function render(overrides: Partial<AccountGroupingSettings> = {}) {
  return renderToStaticMarkup(
    createElement(GroupingPanelBody, {
      settings: {
        grouping: 'type',
        onGroupingChange: noop,
        thenBy: null,
        onThenByChange: noop,
        showLogos: true,
        onShowLogosChange: noop,
        keepExpanded: true,
        onKeepExpandedChange: noop,
        ...overrides,
      },
    }),
  )
}

describe('grouping settings', () => {
  it('labels the two levels and the two switches, and shows the page’s current values', () => {
    const markup = render({ thenBy: 'institution' })

    for (const label of ['Group by', 'Then by', 'Show bank logos', 'Keep groups expanded']) {
      expect(markup).toContain(label)
    }
    expect(markup).toContain('Account type')
    expect(markup).toContain('Institution')
    expect(markup.match(/role="switch"/g)).toHaveLength(2)
  })

  it('shows None for a missing second level and each switch as the page holds it', () => {
    const on = render()
    const off = render({ showLogos: false, keepExpanded: false })

    expect(on).toContain('None')
    expect(on.match(/checked=""/g)).toHaveLength(2)
    expect(off.match(/checked=""/g)).toBeNull()
  })
})
