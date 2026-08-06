/**
 * Tests the account list filters so the options offered, the rows kept and the search cannot drift
 * from the accounts they are derived from
 */
import { describe, expect, it } from 'vitest'
import {
  getActiveFilters,
  getFilteredRows,
  getInstitutionOptions,
  getKindOptions,
  getTypeOptions,
} from '@/pages/accounts/utils/filters'
import { createAccount, createInstitution } from './fixtures'

describe('filter helpers', () => {
  it('removes empty filters before filtering accounts', () => {
    expect(getActiveFilters({
      institution_id: [],
      account_kind: ['asset'],
      account_type: undefined,
    })).toEqual({ account_kind: ['asset'] })
  })

  it('derives sorted and present-only filter options', () => {
    const rows = [
      createAccount({
        id: 'checking',
        account_kind: 'asset',
        account_type: 'checking',
        institution: createInstitution('z', 'Zeta Bank'),
      }),
      createAccount({
        id: 'card',
        account_kind: 'revolving',
        account_type: 'credit_card',
        institution: createInstitution('a', 'Alpha Bank'),
      }),
      createAccount({
        id: 'cash',
        account_kind: 'asset',
        account_type: 'cash',
        institution: createInstitution('z', 'Zeta Bank'),
      }),
    ]

    expect(getInstitutionOptions(rows).map((option) => option.label)).toEqual([
      'Alpha Bank',
      'Zeta Bank',
    ])
    expect(getKindOptions(rows).map((option) => option.value)).toEqual([
      'asset',
      'revolving',
    ])
    expect(getTypeOptions(rows).map((option) => option.value)).toEqual([
      'checking',
      'cash',
      'credit_card',
    ])
  })

  it('applies institution, kind, and type filters together', () => {
    const rows = [
      createAccount({
        id: 'checking',
        account_kind: 'asset',
        account_type: 'checking',
        institution: createInstitution('bank', 'Bank'),
      }),
      createAccount({
        id: 'card',
        account_kind: 'revolving',
        account_type: 'credit_card',
        institution: createInstitution('bank', 'Bank'),
      }),
      createAccount({
        id: 'cash',
        account_kind: 'asset',
        account_type: 'cash',
        institution: null,
      }),
    ]

    expect(getFilteredRows(rows, {
      institution_id: ['bank'],
      account_kind: ['asset'],
      account_type: ['checking'],
    }, '').map((account) => account.id)).toEqual(['checking'])
  })

  it('keeps accounts matching any selected value within a facet', () => {
    const rows = [
      createAccount({ id: 'checking', account_type: 'checking' }),
      createAccount({ id: 'cash', account_type: 'cash' }),
      createAccount({ id: 'savings', account_type: 'savings' }),
    ]

    expect(getFilteredRows(rows, { account_type: ['checking', 'cash'] }, '').map((account) => account.id))
      .toEqual(['checking', 'cash'])
  })

  it('narrows accounts by search across name and institution, ignoring case', () => {
    const rows = [
      createAccount({ id: 'everyday', name: 'Everyday Chequing', institution: createInstitution('td', 'TD') }),
      createAccount({ id: 'rainy', name: 'Rainy Day', institution: createInstitution('rbc', 'RBC') }),
    ]

    expect(getFilteredRows(rows, {}, 'everyday').map((account) => account.id)).toEqual(['everyday'])
    expect(getFilteredRows(rows, {}, 'rbc').map((account) => account.id)).toEqual(['rainy'])
  })
})
