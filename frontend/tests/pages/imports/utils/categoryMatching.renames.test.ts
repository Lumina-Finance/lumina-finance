/**
 * Tests the name a provider import proposes for a new category whose own name an existing category
 * holds for another kind, which would otherwise block the import
 */
import { describe, expect, it } from 'vitest'
import type { Category } from '@/api/categories'
import { CREATE_CATEGORY_VALUE } from '@/pages/imports/constants'
import { getImportCategoryRenames } from '@/pages/imports/utils'

const CREDIT_CARD_PAYMENT = {
  id: 'credit-card-payment',
  group_id: null,
  owner_id: null,
  name: 'Credit Card Payment',
  kind: 'transfer',
  icon: null,
  is_system: true,
  created_at: '2026-01-01T00:00:00Z',
} as Category

const SOURCES = [{ id: 'actual-ccp', name: 'Credit Card Payment' }]

function getRenames(overrides: Partial<Parameters<typeof getImportCategoryRenames>[0]> = {}) {
  return getImportCategoryRenames({
    sources: SOURCES,
    mappings: { 'actual-ccp': CREATE_CATEGORY_VALUE },
    kinds: { 'actual-ccp': 'expense' },
    typedNames: {},
    categoryById: new Map([[CREDIT_CARD_PAYMENT.id, CREDIT_CARD_PAYMENT]]),
    appName: 'Actual',
    ...overrides,
  })
}

describe('renaming a new category whose name another kind holds', () => {
  it('proposes the name marked with the app and says which category holds it', () => {
    expect(getRenames()).toEqual({
      'actual-ccp': { name: 'Credit Card Payment (Actual)', heldBy: CREDIT_CARD_PAYMENT },
    })
  })

  // A cleared field stays cleared, so the import asks for a name rather than quietly restoring one
  it('keeps the name the user typed, even a blank one', () => {
    expect(getRenames({ typedNames: { 'actual-ccp': 'Card payoff' } })['actual-ccp']?.name).toBe('Card payoff')
    expect(getRenames({ typedNames: { 'actual-ccp': '' } })['actual-ccp']?.name).toBe('')
  })

  it('leaves the name alone where nothing blocks it', () => {
    expect(getRenames({ kinds: { 'actual-ccp': 'transfer' } })).toEqual({})
    expect(getRenames({ mappings: { 'actual-ccp': CREDIT_CARD_PAYMENT.id } })).toEqual({})
  })
})
