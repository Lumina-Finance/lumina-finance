/**
 * Guards the recovery codes lockout warning against naming a factor the user doesn't have, as it once
 * named the authenticator app on every passkey screen
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecoveryCodesPanel, type RecoveryFactors } from '@/components/two-factor/RecoveryCodesPanel'

function renderWarning(factors: RecoveryFactors) {
  return renderToStaticMarkup(<RecoveryCodesPanel codes={['aaaa-bbbb']} factors={factors} />)
}

describe('recovery codes lockout warning', () => {
  it('names only the authenticator app for authenticator codes', () => {
    const markup = renderWarning({ authenticator: true, passkeys: 0 })
    expect(markup).toContain('both your authenticator app and these recovery codes')
    expect(markup).not.toContain('passkey')
  })

  it('names only the passkey for a single passkey', () => {
    const markup = renderWarning({ authenticator: false, passkeys: 1 })
    expect(markup).toContain('both your passkey and these recovery codes')
    expect(markup).not.toContain('authenticator')
  })

  it('names the passkeys when there are several', () => {
    const markup = renderWarning({ authenticator: false, passkeys: 2 })
    expect(markup).toContain('both your passkeys and these recovery codes')
    expect(markup).not.toContain('authenticator')
  })

  it('names both factors when the codes cover both', () => {
    const markup = renderWarning({ authenticator: true, passkeys: 1 })
    expect(markup).toContain('your authenticator app, your passkey and these recovery codes')
  })
})
