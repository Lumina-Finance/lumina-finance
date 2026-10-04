/**
 * Guards what only an import from another app adds to the shared import run: counting the sources
 * it creates, and the summary line that counts its skipped rows and budgets
 */
import { describe, expect, it } from 'vitest'
import type { JournalImportRunResponse } from '@/api/provider-imports'
import { countCreatedImportSources, formatProviderImportSummary } from '@/pages/imports/utils'
import { withPlainSpaces } from './fixtures'

/** Creates a complete import result with empty counters and mappings unless overridden */
function createImportResult(overrides: Partial<JournalImportRunResponse> = {}): JournalImportRunResponse {
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
    rows_imported: 0,
    budgets_created: 0,
    budgets: [],
    accounts_archived: 0,
    archive_adjustments_created: 0,
    ...overrides,
  }
}

describe('counting the sources an import creates', () => {
  it('leaves out a source answered create whose rows are all left out of the upload', () => {
    const mappings = { Checking: 'create', Savings: 'create', Wallet: 'account-1' }

    expect(countCreatedImportSources(['Checking', 'Savings', 'Wallet'], mappings, 'create', new Set(['Checking', 'Wallet']))).toBe(1)
  })
})

describe('the completed provider import summary', () => {
  it('counts the rows the browser left out as skipped', () => {
    const result = createImportResult({ rows_imported: 1, transactions_created: 1 })

    expect(withPlainSpaces(formatProviderImportSummary(result, 2))).toBe('1 row imported · 1 transaction created · 2 skipped')
  })

  it('preserves plural row, transaction and budget segments in their current order', () => {
    const result = createImportResult({ rows_imported: 2, transactions_created: 2, budgets_created: 2 })

    expect(withPlainSpaces(formatProviderImportSummary(result, 1))).toBe('2 rows imported · 2 transactions created · 1 skipped · 2 budgets imported')
  })

  // A narrow overlay wraps the summary, and a break inside a count strands its number from its word
  it('lets a line break only after a separator', () => {
    const result = createImportResult({ rows_imported: 10, transactions_created: 11 })

    expect(formatProviderImportSummary(result, 0).split(' ')).toEqual([
      '10\u00a0rows\u00a0imported\u00a0·',
      '11\u00a0transactions\u00a0created\u00a0·',
      '0\u00a0skipped',
    ])
  })
})
