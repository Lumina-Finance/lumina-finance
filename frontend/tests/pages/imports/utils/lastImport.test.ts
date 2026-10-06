/**
 * Tests the undo confirmation's claims about an import
 *
 * These tests catch regressions where the confirmation misstates how many transactions or created
 * records go, or names the wrong file
 */
import { describe, expect, it } from 'vitest'
import type { LastImport } from '@/api/import-runs'
import { describeUndoDeletion } from '@/pages/imports/utils/lastImport'

function entry(overrides: Partial<LastImport> = {}): LastImport {
  return {
    id: 'run-1',
    source: 'generic',
    file_name: 'everyday-test.csv',
    committed_at: '2026-10-04T12:00:00Z',
    undo_until: '2026-10-07T12:00:00Z',
    transaction_count: 240,
    account_count: 0,
    category_count: 0,
    merchant_count: 0,
    tag_count: 0,
    budget_count: 0,
    ...overrides,
  }
}

describe('what undoing an import deletes', () => {
  it.each([
    [{}, 'This deletes everything everyday-test.csv added: 240\u00a0transactions.'],
    [
      { account_count: 1, category_count: 3, merchant_count: 2 },
      'This deletes everything everyday-test.csv added: 240\u00a0transactions, 1\u00a0account, 3\u00a0categories and 2\u00a0merchants.',
    ],
    [
      { transaction_count: 1, file_name: null, tag_count: 1, budget_count: 2 },
      'This deletes everything this import added: 1\u00a0transaction, 1\u00a0tag and 2\u00a0budgets.',
    ],
  ])('lists every count for %o', (overrides, sentence) => {
    expect(describeUndoDeletion(entry(overrides))).toBe(sentence)
  })
})
