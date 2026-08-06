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

const currencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
]

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
    is_archived: overrides.is_archived ?? false,
    closed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('identity form helpers', () => {
  it('creates editable form values from nullable backend account fields', () => {
    expect(createIdentityFormValues(createAccount({
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
      is_archived: true,
    }), currencies)).toEqual({
      name: 'Account',
      institution_id: 'bank',
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
      tax_advantaged_category_id: 'plan',
      credit_limit: '1234.56',
      is_archived: true,
    }

    expect(getIdentityUpdatePayload({
      form,
      isRevolving: true,
      canLinkTaxAdvantagedCategory: false,
      currencies,
      accountCurrency: 'USD',
    })).toEqual({
      name: 'Travel Card',
      institution_id: null,
      is_archived: true,
      credit_limit: 123_456,
    })
    expect(getIdentityUpdatePayload({
      form,
      isRevolving: false,
      canLinkTaxAdvantagedCategory: true,
      currencies,
      accountCurrency: 'USD',
    })).toEqual({
      name: 'Travel Card',
      institution_id: null,
      is_archived: true,
      tax_advantaged_category_id: 'plan',
    })
  })

  it('round-trips a seeded credit limit back to the same stored minor units unchanged', () => {
    const account = createAccount({ account_kind: 'revolving', credit_limit: 123_456 })
    const form = createIdentityFormValues(account, currencies)

    expect(form.credit_limit).toBe('1234.56')
    expect(getIdentityUpdatePayload({
      form,
      isRevolving: true,
      canLinkTaxAdvantagedCategory: false,
      currencies,
      accountCurrency: 'USD',
    })).toEqual({
      name: 'Account',
      institution_id: null,
      is_archived: false,
      credit_limit: 123_456,
    })
  })

  it('withholds the credit limit rather than scaling it by a guess when the currency is not in the table', () => {
    const account = createAccount({ account_kind: 'revolving', credit_limit: 500_000, currency: 'JPY' })
    const form = createIdentityFormValues(account, [])

    // Blank rather than 5000.00, which is what two assumed decimal places would have shown for ¥500,000
    expect(form.credit_limit).toBe('')

    // Left out of the payload entirely, since a blank converts to null and would clear the stored limit
    expect(getIdentityUpdatePayload({
      form,
      isRevolving: true,
      canLinkTaxAdvantagedCategory: false,
      currencies: [],
      accountCurrency: 'JPY',
    })).toEqual({
      name: 'Account',
      institution_id: null,
      is_archived: false,
    })
  })

})
