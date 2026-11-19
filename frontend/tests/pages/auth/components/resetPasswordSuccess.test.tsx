/**
 * Covers the screen a finished password reset shows
 *
 * These tests catch a reset that removed the account's linked sign-in providers without saying
 * so, a notice worded for several providers when one was removed or the other way round, and a
 * password-only reset that wrongly mentions providers. A silent removal leaves the user wondering
 * why their provider button no longer signs them in
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResetPasswordSuccess } from '@/pages/auth/components/ResetPasswordSuccess'

/** The markup of the success screen after a reset that removed the given number of providers */
function render(signInProvidersRemoved: number) {
  return renderToStaticMarkup(
    <ResetPasswordSuccess signInProvidersRemoved={signInProvidersRemoved} onGoToLogin={() => {}} />,
  )
}

describe('the reset success screen', () => {
  it('says the one linked sign-in provider was removed', () => {
    const markup = render(1)

    expect(markup).toContain('Your password has been reset.')
    expect(markup).toContain('Your linked sign-in provider was removed. You can link it again in Settings.')
    expect(markup).not.toContain('providers were removed')
  })

  it('says the linked sign-in providers were removed when the reset removed several', () => {
    const markup = render(2)

    expect(markup).toContain('Your password has been reset.')
    expect(markup).toContain('Your linked sign-in providers were removed. You can link them again in Settings.')
    expect(markup).not.toContain('provider was removed')
  })

  it('stays as it was for a reset that changed only the password', () => {
    const markup = render(0)

    expect(markup).toContain('Your password has been reset.')
    expect(markup).not.toContain('sign-in provider')
  })
})
