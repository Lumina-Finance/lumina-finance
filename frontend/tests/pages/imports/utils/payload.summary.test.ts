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
    transactions_already_imported: 0,
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

    expect(withPlainSpaces(formatImportSummary(summary, 0, 0))).toBe('1 transaction imported · 1 account created · 1 category created')
  })

  // Zero takes the plural in all three, the same as any count above one
  it('states zero of each, plural', () => {
    expect(withPlainSpaces(formatImportSummary(createSummary(), 0, 0))).toBe(
      '0 transactions imported · 0 accounts created · 0 categories created',
    )
  })

  // The count has to pass a thousand for this case to mean anything, since a switch to a grouped
  // number would render 1,234 and any smaller count reads the same either way
  it('writes a count past a thousand ungrouped', () => {
    const summary = createSummary({ transactions_created: 1234, accounts_created: 2, categories_created: 7 })

    expect(withPlainSpaces(formatImportSummary(summary, 0, 0))).toBe('1234 transactions imported · 2 accounts created · 7 categories created')
  })

  // A file that imported whole reads as it always has, so the count joins only when rows were left out
  it('counts the rows the import left out, when there were some', () => {
    expect(withPlainSpaces(formatImportSummary(createSummary({ transactions_created: 2 }), 1, 0))).toBe(
      '2 transactions imported · 0 accounts created · 0 categories created · 1 skipped',
    )
  })

  // An overlapping statement adds only what's new, so the line says how many it found already there.
  // The zero case above shows the part is left out when nothing was
  it('counts the transactions already in their account, when there were some', () => {
    const summary = createSummary({
      transactions_created: 16,
      transactions_already_imported: 15,
      account_source_ids: { Statement: 'account-1' },
    })

    expect(withPlainSpaces(formatImportSummary(summary, 1, 0))).toBe(
      '16 transactions imported · 0 accounts created · 0 categories created · 15 already in the account · 1 skipped',
    )
  })

  // One file can hold a chequing and a savings statement, and "the account" would name only one
  it('counts the transactions already imported without naming an account when the import went to several', () => {
    const summary = createSummary({
      transactions_created: 4,
      transactions_already_imported: 3,
      account_source_ids: { Chequing: 'account-1', Savings: 'account-2' },
    })

    expect(withPlainSpaces(formatImportSummary(summary, 0, 0))).toBe(
      '4 transactions imported · 0 accounts created · 0 categories created · 3 already imported',
    )
  })

  // Two statements answered with one account still went to one account
  it('names the account when every statement went to the same one', () => {
    const summary = createSummary({
      transactions_created: 4,
      transactions_already_imported: 3,
      account_source_ids: { January: 'account-1', February: 'account-1' },
    })

    expect(withPlainSpaces(formatImportSummary(summary, 0, 0))).toBe(
      '4 transactions imported · 0 accounts created · 0 categories created · 3 already in the account',
    )
  })

  // Rows left out on purpose are counted apart from the rows that couldn't be imported, so neither
  // count is read as the other
  it('counts the rows outside the chosen dates apart from the skipped ones', () => {
    expect(withPlainSpaces(formatImportSummary(createSummary({ transactions_created: 2 }), 1, 1200))).toBe(
      '2 transactions imported · 0 accounts created · 0 categories created · 1 skipped · 1200 outside the chosen dates',
    )
  })

  // A narrow overlay wraps the summary, and a break inside a count strands its number from its word
  it('lets a line break only after a separator', () => {
    expect(formatImportSummary(createSummary(), 0, 0).split(' ')).toEqual([
      '0\u00a0transactions\u00a0imported\u00a0·',
      '0\u00a0accounts\u00a0created\u00a0·',
      '0\u00a0categories\u00a0created',
    ])
  })
})
