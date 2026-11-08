/**
 * Tests which settings sections show, so a rewrite catches Bank connections shown to a user the
 * bank-linking check refuses, or held back from everyone while the check loads
 */
import { describe, expect, it } from 'vitest'
import { isHeldWhenLinked, listSettingsSections, SETTINGS_SECTIONS } from '@/pages/settings/settingsNavigation'

describe('sections held when linked', () => {
  it('holds only Bank connections, so a link to any other section scrolls once as it always has', () => {
    expect(SETTINGS_SECTIONS.filter((section) => isHeldWhenLinked(section.id)).map((section) => section.id)).toEqual([
      'bank-connections',
    ])
  })
})

describe('settings sections', () => {
  it('leaves out Bank connections when the bank-linking check refuses the user', () => {
    expect(listSettingsSections(false).map((section) => section.id)).not.toContain('bank-connections')
    expect(listSettingsSections(false)).toHaveLength(SETTINGS_SECTIONS.length - 1)
  })

  it('shows every section when the check allows linking or is still loading', () => {
    expect(listSettingsSections(true)).toEqual(SETTINGS_SECTIONS)
    expect(listSettingsSections(undefined)).toEqual(SETTINGS_SECTIONS)
  })
})
