/**
 * Covers the warning the new-password form shows before a reset removes linked sign-in providers
 *
 * These tests catch a warning worded for several providers when one is linked or the other way
 * round, and a warning shown to an account with none linked or after a failed link check, where
 * it would claim a removal that won't happen
 */
import { describe, expect, it } from 'vitest'
import { describeProviderRemoval } from '@/pages/auth/utils/providerRemoval'

describe('the provider warning on the reset form', () => {
  it('warns about the one linked provider', () => {
    expect(describeProviderRemoval({ sign_in_providers_linked: 1 })).toBe(
      'Resetting your password also removes your linked sign-in provider. You can link it again in Settings.',
    )
  })

  it('warns about every linked provider when there are several', () => {
    expect(describeProviderRemoval({ sign_in_providers_linked: 2 })).toBe(
      'Resetting your password also removes your linked sign-in providers. You can link them again in Settings.',
    )
  })

  it.each([
    ['no provider is linked', { sign_in_providers_linked: 0 }],
    ['the link check has no answer', undefined],
  ])('says nothing when %s', (_label, status) => {
    expect(describeProviderRemoval(status)).toBeUndefined()
  })
})
