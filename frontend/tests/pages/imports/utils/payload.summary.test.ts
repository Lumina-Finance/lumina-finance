/**
 * Tests the summary shown once an import finishes
 */
import { describe, expect, it } from 'vitest'
import type { TransactionImportResponse } from '@/api/transaction-imports'
import { formatImportSummary } from '@/pages/imports/utils'
import { withPlainSpaces } from './fixtures'

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

    expect(withPlainSpaces(formatImportSummary(summary, 0))).toBe('1 transaction imported · 1 account created · 1 category created')
  })

  // Zero takes the plural in all three, the same as any count above one
  it('states zero of each, plural', () => {
    expect(withPlainSpaces(formatImportSummary(createSummary(), 0))).toBe(
      '0 transactions imported · 0 accounts created · 0 categories created',
    )
  })

  // The count has to pass a thousand for this case to mean anything, since a switch to a grouped
  // number would render 1,234 and any smaller count reads the same either way
  it('writes a count past a thousand ungrouped', () => {
    const summary = createSummary({ transactions_created: 1234, accounts_created: 2, categories_created: 7 })

    expect(withPlainSpaces(formatImportSummary(summary, 0))).toBe('1234 transactions imported · 2 accounts created · 7 categories created')
  })

  // A file that imported whole reads as it always has, so the count joins only when rows were left out
  it('counts the rows the import left out, when there were some', () => {
    expect(withPlainSpaces(formatImportSummary(createSummary({ transactions_created: 2 }), 1))).toBe(
      '2 transactions imported · 0 accounts created · 0 categories created · 1 skipped',
    )
  })

  // A narrow overlay wraps the summary, and a break inside a count strands its number from its word
  it('lets a line break only after a separator', () => {
    expect(formatImportSummary(createSummary(), 0).split(' ')).toEqual([
      '0\u00a0transactions\u00a0imported\u00a0·',
      '0\u00a0accounts\u00a0created\u00a0·',
      '0\u00a0categories\u00a0created',
    ])
  })
})
