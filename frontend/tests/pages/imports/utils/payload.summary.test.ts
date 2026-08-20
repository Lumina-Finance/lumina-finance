/**
 * Tests the one-line summary shown once an import finishes, and the fallback message shown when it
 * fails with nothing usable to report
 */
import { describe, expect, it } from 'vitest'
import type { TransactionImportResponse } from '@/api/transaction-imports'
import { formatImportSummary, getErrorMessage } from '@/pages/imports/utils'

/**
 * Creates a completed import's response, defaulting every count to zero
 */
function createSummary(overrides: Partial<TransactionImportResponse> = {}): TransactionImportResponse {
  return {
    transactions_created: 0,
    accounts_created: 0,
    accounts_reused: 0,
    categories_created: 0,
    categories_reused: 0,
    merchants_created: 0,
    merchants_reused: 0,
    tags_created: 0,
    tags_reused: 0,
    affected_account_ids: [],
    account_source_ids: {},
    category_source_ids: {},
    created_account_ids: [],
    created_category_ids: [],
    created_merchant_ids: [],
    created_tag_ids: [],
    ...overrides,
  }
}

describe('summarizing a completed import', () => {
  it('states one of each, singular, joined by the separator', () => {
    const summary = createSummary({ transactions_created: 1, accounts_created: 1, categories_created: 1 })

    expect(formatImportSummary(summary)).toBe('1 transaction imported · 1 account created · 1 category created')
  })

  // Zero takes the plural in all three, the same as any count above one
  it('states zero of each, plural', () => {
    expect(formatImportSummary(createSummary())).toBe(
      '0 transactions imported · 0 accounts created · 0 categories created',
    )
  })

  // The count has to pass a thousand for this case to mean anything, since a switch to a grouped
  // number would render 1,234 and any smaller count reads the same either way
  it('writes a count past a thousand ungrouped', () => {
    const summary = createSummary({ transactions_created: 1234, accounts_created: 2, categories_created: 7 })

    expect(formatImportSummary(summary)).toBe('1234 transactions imported · 2 accounts created · 7 categories created')
  })
})

describe('falling back to a generic failure message', () => {
  // An empty message used to reach the user as a blank failure notice, since nothing here caught it
  it('falls back for an Error with no message', () => {
    expect(getErrorMessage(new Error(''))).toBe('Import failed.')
  })

  it('falls back for a rejection that is not an Error', () => {
    expect(getErrorMessage('boom')).toBe('Import failed.')
    expect(getErrorMessage({ message: 'boom' })).toBe('Import failed.')
  })
})
