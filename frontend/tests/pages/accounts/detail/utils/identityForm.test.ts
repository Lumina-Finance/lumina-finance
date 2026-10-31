/**
 * Tests the account identity form so the fields it shows, the errors it raises, and the payload it
 * builds cannot drift from the account kind they belong to
 */
import { describe, expect, it } from 'vitest'
import type { Account } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import {
  createIdentityFormValues,
  getIdentityFieldErrors,
  getIdentityUpdatePayload,
} from '@/pages/accounts/detail/utils/identityForm'

const currencies: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? 'account',
    owner_id: null,
    group_id: null,
    account_kind: overrides.account_kind ?? 'asset',
    account_type: overrides.account_type ?? 'checking',
    tax_advantaged_category_id: overrides.tax_advantaged_category_id ?? null,
    name: overrides.name ?? 'Account',
    institution: overrides.institution ?? null,
    currency: overrides.currency ?? 'USD',
    current_balance: overrides.current_balance ?? 0,
    base_currency_current_balance: overrides.base_currency_current_balance ?? null,
    current_balance_fx_status: overrides.current_balance_fx_status ?? { state: 'none', missing_pairs: [] },
    credit_limit: overrides.credit_limit ?? null,
    notes: overrides.notes ?? null,
    can_write: overrides.can_write ?? true,
    is_archived: overrides.is_archived ?? false,
    created_at: '2026-01-01T00:00:00Z',
    has_transactions_after_today: overrides.has_transactions_after_today ?? false,
    ...overrides,
  }
}

describe('identity form helpers', () => {
  it('creates editable form values from nullable backend account fields', () => {
    expect(
      createIdentityFormValues(
        createAccount({
          institution: {
            id: 'bank',
            status: 'active',
            name: 'Bank',
            country_code: 'US',
            website: 'https://bank.example.com',
            logo_url: null,
          },
          tax_advantaged_category_id: 'plan',
          credit_limit: 1_234,
          notes: 'Customer 42',
          is_archived: true,
        }),
        currencies,
      ),
    ).toEqual({
      name: 'Account',
      institution_id: 'bank',
      notes: 'Customer 42',
      tax_advantaged_category_id: 'plan',
      credit_limit: '12.34',
      is_archived: true,
    })
  })

  it('validates required names and only checks credit limits for revolving accounts', () => {
    const form = createIdentityFormValues(createAccount(), currencies)

    expect(getIdentityFieldErrors({ ...form, name: '   ' }, false)).toEqual({
      name: 'Name is required.',
    })
    expect(getIdentityFieldErrors({ ...form, credit_limit: '-1' }, true)).toEqual({
      credit_limit: 'Credit limit must be zero or higher.',
    })
    expect(getIdentityFieldErrors({ ...form, credit_limit: '-1' }, false)).toEqual({})
  })

  it('builds update payloads without sending fields hidden for the account kind', () => {
    const form = {
      name: '  Travel Card  ',
      institution_id: '',
      notes: '',
      tax_advantaged_category_id: 'plan',
      credit_limit: '1234.56',
      is_archived: true,
    }

    expect(
      getIdentityUpdatePayload({
        form,
        isRevolving: true,
        canLinkTaxAdvantagedCategory: false,
        currencies,
        accountCurrency: 'USD',
      }),
    ).toEqual({
      name: 'Travel Card',
      institution_id: null,
      notes: null,
      is_archived: true,
      credit_limit: 123_456,
    })
    expect(
      getIdentityUpdatePayload({
        form,
        isRevolving: false,
        canLinkTaxAdvantagedCategory: true,
        currencies,
        accountCurrency: 'USD',
      }),
    ).toEqual({
      name: 'Travel Card',
      institution_id: null,
      notes: null,
      is_archived: true,
      tax_advantaged_category_id: 'plan',
    })
  })

  it('sends trimmed notes, clears them when blank and refuses notes past the limit', () => {
    const form = createIdentityFormValues(createAccount({ notes: 'Customer 42' }), currencies)
    const payloadFor = (notes: string) =>
      getIdentityUpdatePayload({
        form: { ...form, notes },
        isRevolving: false,
        canLinkTaxAdvantagedCategory: false,
        currencies,
        accountCurrency: 'USD',
      })

    expect(payloadFor('  Account 123\nBranch 7  ').notes).toBe('Account 123\nBranch 7')
    expect(payloadFor('   ').notes).toBeNull()
    expect(getIdentityFieldErrors({ ...form, notes: 'x'.repeat(2000) }, false)).toEqual({})
    expect(getIdentityFieldErrors({ ...form, notes: 'x'.repeat(2001) }, false)).toEqual({
      notes: 'Notes must be 2000 characters or less.',
    })
  })

  it('withholds a JPY credit limit from an empty currency table', () => {
    const account = createAccount({
      account_kind: 'revolving',
      credit_limit: 500_000,
      currency: 'JPY',
    })
    const form = createIdentityFormValues(account, [])

    // Blank rather than a guessed two-place amount
    expect(form.credit_limit).toBe('')

    // A name-only save leaves the unreadable stored limit out rather than clearing or rescaling it
    expect(
      getIdentityUpdatePayload({
        form: { ...form, name: 'Renamed account' },
        isRevolving: true,
        canLinkTaxAdvantagedCategory: false,
        currencies: [],
        accountCurrency: 'JPY',
      }),
    ).toEqual({
      name: 'Renamed account',
      institution_id: null,
      notes: null,
      is_archived: false,
    })
  })
})
