/**
 * Tests which settings sections show, so a rewrite catches Bank connections shown where the deployment
 * offers the user no bank sync
 */
import { describe, expect, it } from 'vitest'
import { createProviders } from '@tests/pages/accounts/detail/components/bank-link/fixtures'
import { isHeldWhenLinked, listSettingsSections, SETTINGS_SECTIONS } from '@/pages/settings/settingsNavigation'

describe('sections held when linked', () => {
  it('holds only Bank connections, so a link to any other section scrolls once as it always has', () => {
    expect(SETTINGS_SECTIONS.filter((section) => isHeldWhenLinked(section.id)).map((section) => section.id)).toEqual([
      'bank-connections',
    ])
  })
})

describe('settings sections', () => {
  const withoutBankConnections = SETTINGS_SECTIONS.filter((section) => section.id !== 'bank-connections')

  it('shows every section while the deployment offers bank sync to the user', () => {
    expect(listSettingsSections(createProviders(), 'shown')).toEqual(SETTINGS_SECTIONS)
  })

  it('shows the sections as they are without bank sync when no provider is enabled', () => {
    expect(listSettingsSections(createProviders({ providers: [] }), 'shown')).toEqual(withoutBankConnections)
  })

  it('shows the sections as they are without bank sync when the bank-linking check refuses the user', () => {
    expect(listSettingsSections(createProviders({ may_link: false }), 'shown')).toEqual(withoutBankConnections)
  })

  it('keeps Bank connections for a refused user when the build covers the section with its own screen', () => {
    expect(listSettingsSections(createProviders({ may_link: false }), 'covered')).toEqual(SETTINGS_SECTIONS)
  })

  it('leaves out Bank connections while the build waits to learn whether to cover it, so a link to it scrolls once it is drawn', () => {
    expect(listSettingsSections(createProviders(), 'pending')).toEqual(withoutBankConnections)
  })

  it('leaves out Bank connections until the providers are read, so it never shows for a moment without bank sync', () => {
    expect(listSettingsSections(undefined, 'shown')).toEqual(withoutBankConnections)
  })
})
