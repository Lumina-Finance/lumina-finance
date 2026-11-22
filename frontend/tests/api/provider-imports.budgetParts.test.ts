/**
 * Covers how the budgets of a provider import are split into requests, so no request is one the API
 * refuses and a heavy import never has to send its budgets in one
 *
 * A part is closed on its bytes and on the category mappings the API takes in one request. A part
 * that carried a mapping only another part needs, or lost the order of the budgets, would give the
 * run budgets that are wrong or missing once it commits
 */
import { describe, expect, it } from 'vitest'

import { buildImportBudgetParts } from '@/api/provider-imports'
import type { ImportBudgetDraft, ImportRunBudgets } from '@/api/provider-imports'
import { MAX_IMPORT_BATCH_BYTES, MAX_IMPORT_BATCH_MAPPINGS, getJsonByteSize } from '@/api/shared/importBatchSize'

// Limit periods enough that a handful of budgets fill a part's byte budget, below the API's cap
const LONG_HISTORY = Array.from({ length: 1200 }, (_, index) => ({
  start: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
  end: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
  amount: '1234.567890123456',
}))

/**
 * Builds the budget named for its index, tracking the given category sources
 */
function buildDraft(index: number, categorySources: string[], limits = LONG_HISTORY.slice(0, 1)): ImportBudgetDraft {
  return {
    name: `Budget ${index}`,
    currency: 'CAD',
    category_sources: categorySources,
    limits,
    recurrence: null,
    is_archived: false,
  }
}

/**
 * Builds a request holding the given budgets and a mapping for every category source they name
 */
function buildBudgets(drafts: ImportBudgetDraft[]): ImportRunBudgets {
  const sources = [...new Set(drafts.flatMap((draft) => draft.category_sources))]
  return {
    categories: sources.map((source) => ({ source, create: { name: source, kind: 'expense' } })),
    budgets: drafts,
  }
}

describe('the parts the budgets of an import are sent in', () => {
  it('sends a few budgets as one part starting at the first', () => {
    const budgets = buildBudgets([buildDraft(0, ['A']), buildDraft(1, ['B'])])

    expect(buildImportBudgetParts(budgets)).toEqual([{ ...budgets, start_index: 0 }])
  })

  it('sends nothing for an import with no budgets', () => {
    expect(buildImportBudgetParts({ categories: [], budgets: [] })).toEqual([])
  })

  it('keeps every part under the request budget and the budgets in order, each part saying where it starts', () => {
    const drafts = Array.from({ length: 40 }, (_, index) => buildDraft(index, [`Category ${index}`], LONG_HISTORY))

    const parts = buildImportBudgetParts(buildBudgets(drafts))

    expect(parts.length).toBeGreaterThan(1)
    let expectedStart = 0
    for (const part of parts) {
      expect(part.start_index).toBe(expectedStart)
      expect(getJsonByteSize(part)).toBeLessThanOrEqual(MAX_IMPORT_BATCH_BYTES)
      expectedStart += part.budgets.length
    }
    expect(parts.flatMap((part) => part.budgets)).toEqual(drafts)
  })

  it('closes a part on the mapping count, not only on its bytes', () => {
    // Each budget tracks sixty categories of its own, so the mappings fill up long before the bytes do
    const drafts = Array.from({ length: 20 }, (_, index) =>
      buildDraft(
        index,
        Array.from({ length: 60 }, (_, category) => `Category ${index}-${category}`),
      ),
    )

    const parts = buildImportBudgetParts(buildBudgets(drafts))

    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part.categories.length).toBeLessThanOrEqual(MAX_IMPORT_BATCH_MAPPINGS)
    expect(parts.flatMap((part) => part.budgets)).toEqual(drafts)
  })

  it('gives each part only the mappings its own budgets name, a shared one in every part that needs it', () => {
    const drafts = Array.from({ length: 40 }, (_, index) =>
      buildDraft(index, ['Shared', `Category ${index}`], LONG_HISTORY),
    )

    const parts = buildImportBudgetParts(buildBudgets(drafts))

    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) {
      const named = new Set(part.budgets.flatMap((budget) => budget.category_sources))
      expect(new Set(part.categories.map((mapping) => mapping.source))).toEqual(named)
      expect(part.categories).toHaveLength(named.size)
    }
  })

  it('refuses one budget alone over the byte budget, naming it', () => {
    const budget = { ...buildDraft(0, ['A']), name: 'x'.repeat(MAX_IMPORT_BATCH_BYTES) }

    expect(() => buildImportBudgetParts(buildBudgets([budget]))).toThrow(
      `The ${budget.name} budget is too large to upload safely.`,
    )
  })

  it('refuses one budget alone over the mapping cap, naming it', () => {
    const sources = Array.from({ length: MAX_IMPORT_BATCH_MAPPINGS + 1 }, (_, index) => `Category ${index}`)

    expect(() => buildImportBudgetParts(buildBudgets([buildDraft(0, sources)]))).toThrow(
      'The Budget 0 budget is too large to upload safely.',
    )
  })

  it('refuses the whole import when a budget in a later part is too large, before any part is sent', () => {
    const fits = Array.from({ length: 40 }, (_, index) => buildDraft(index, [`Category ${index}`], LONG_HISTORY))
    const tooLarge = { ...buildDraft(40, ['A']), name: 'x'.repeat(MAX_IMPORT_BATCH_BYTES) }

    expect(() => buildImportBudgetParts(buildBudgets([...fits, tooLarge]))).toThrow(/too large to upload safely/)
  })
})
