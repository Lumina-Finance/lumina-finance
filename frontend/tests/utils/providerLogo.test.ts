/**
 * Guards the sign-in provider logos shipped with the app: a provider named after a shipped
 * app gets its logo from the app's own server, and any other name falls back to the globe
 */
import { describe, expect, it } from 'vitest'
import { getProviderLogoUrl } from '@/utils/providerLogo'

describe('getProviderLogoUrl', () => {
  it.each([
    ['Authentik', 'authentik'],
    ['Authelia', 'authelia'],
    ['  Pocket ID ', 'pocket-id'],
    ['KEYCLOAK', 'keycloak'],
    ['Zitadel', 'zitadel'],
    ['Kanidm', 'kanidm'],
    ['Casdoor', 'casdoor'],
    ['Rauthy', 'rauthy'],
  ])('finds the shipped logo for a provider named %s', (name, slug) => {
    const url = getProviderLogoUrl(name)

    expect(url).toContain(slug)
    // A path on the app's own server, never another site, protocol-relative addresses included
    expect(url).toMatch(/^\/(?!\/)/)
  })

  it.each([['Acme Single Sign-On'], ['OIDC'], [''], [undefined]])('has no logo for a provider named %s', (name) => {
    expect(getProviderLogoUrl(name)).toBeNull()
  })
})
