/**
 * Tests that a previewed row shows what the import rules give it in place of what the file gives
 *
 * These tests catch a preview showing the file's category, merchant or tags where the save would
 * write a rule's, or a rule's value shown on a row no rule gave it
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { ImportRuleRowMatch } from '@/api/import-rules'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import { buildImportPreviewRows, getImportRowId, WHOLE_FILE_DATE_RANGE } from '@/pages/imports/utils'

const RULE = { id: 'rule-1', name: 'Coffee' }
const FILE_CATEGORY = { id: 'groceries', name: 'Groceries', kind: 'expense' } as Category
const RULE_CATEGORY = { id: 'dining', name: 'Dining', kind: 'expense' } as Category
const ACCOUNT = { id: 'checking', name: 'Checking', currency: 'CAD', institution: null } as AccountsOverview

const FILE: ImportFileDraft = {
  id: 'file-1',
  name: 'Checking.csv',
  size: 1,
  headers: ['Date', 'Amount', 'Category', 'Merchant', 'Tags'],
  hasHeaderRow: true,
  rows: [{ Date: '2026-04-10', Amount: '-12.34', Category: 'Groceries', Merchant: 'Cafe 12', Tags: 'food' }],
  error: null,
}

function preview(match: ImportRuleRowMatch | null) {
  return buildImportPreviewRows({
    files: [FILE],
    columnMap: {
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      amount: 'Amount',
      category_id: 'Category',
      merchant_id: 'Merchant',
      tag_ids: 'Tags',
    },
    dateFormat: 'yearFirst',
    dateRange: WHOLE_FILE_DATE_RANGE,
    directionAnswers: {},
    missingRequiredColumnLabels: [],
    currencies: [{ id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 }],
    accountById: new Map([[ACCOUNT.id, ACCOUNT]]),
    accountCreateCurrencies: {},
    accountCreateInstitutions: {},
    categoryById: new Map([FILE_CATEGORY, RULE_CATEGORY].map((category) => [category.id, category])),
    categoryCreateKinds: {},
    categoryTypesBySource: {},
    institutionById: new Map(),
    resolvedAccountMappings: { 'file-1': ACCOUNT.id },
    resolvedCategoryMappings: { Groceries: FILE_CATEGORY.id },
    rowProblems: [],
    ruleMatches: match ? new Map([[getImportRowId('file-1', 0), match]]) : null,
  })
}

describe('a previewed row under import rules', () => {
  it('shows the file as it is until the rules have answered', () => {
    const [row] = preview(null)
    expect(row.transaction.merchant_name).toBe('Cafe 12')
    expect(row.category?.id).toBe(FILE_CATEGORY.id)
    expect(row.isMerchantFromRule).toBeUndefined()
  })

  it('takes the merchant and category a rule gives and adds its tags to the file own', () => {
    const [row] = preview({
      merchant: { id: 'm-1', name: 'Cafe', rule: RULE },
      category: { id: RULE_CATEGORY.id, name: RULE_CATEGORY.name, rule: RULE },
      tags: [
        { id: 't-1', name: 'Food', rule: RULE },
        { id: 't-2', name: 'Treat', rule: RULE },
      ],
      tag_count: 2,
    })

    expect(row.transaction.merchant_name).toBe('Cafe')
    expect(row.isMerchantFromRule).toBe(true)
    expect(row.category?.id).toBe(RULE_CATEGORY.id)
    expect(row.transaction.tags.map((tag) => tag.name)).toEqual(['food', 'Treat'])
  })

  it('keeps the file where the rules give nothing', () => {
    const [row] = preview({ merchant: null, category: null, tags: [], tag_count: 1 })
    expect(row.transaction.merchant_name).toBe('Cafe 12')
    expect(row.category?.id).toBe(FILE_CATEGORY.id)
  })
})
