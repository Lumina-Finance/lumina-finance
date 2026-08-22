/**
 * Tests the account spending breakdown view model so the Other row, the bar fills, the rows built
 * from a backend payload and the merchant total explanation cannot drift from the totals they are
 * derived from
 */
import { describe, expect, it } from 'vitest'
import type { AccountSpendingBreakdown } from '@/api/accounts'
import {
  appendOtherBreakdownRow,
  getBreakdownRowFillPercent,
  getBreakdownRows,
  shouldExplainMerchantsTotal,
} from '@/pages/accounts/detail/utils/spendingBreakdownViewModel'

describe('spending breakdown view model helpers', () => {
  it('adds an Other row from what the card total leaves over', () => {
    expect(appendOtherBreakdownRow([
      { key: 'groceries', name: 'Groceries', total: 6_000, isOther: false },
      { key: 'travel', name: 'Travel', total: 3_000, isOther: false },
    ], 3, 10_000)).toEqual([
      { key: 'groceries', name: 'Groceries', total: 6_000, isOther: false },
      { key: 'travel', name: 'Travel', total: 3_000, isOther: false },
      { key: 'other', name: 'Other (3)', total: 1_000, isOther: true },
    ])
  })

  it('keeps tiny non-zero breakdown rows visible and handles signed totals', () => {
    expect(getBreakdownRowFillPercent(10, 10_000)).toBe(4)
    expect(getBreakdownRowFillPercent(-2_500, -10_000)).toBe(25)
    expect(getBreakdownRowFillPercent(0, 0)).toBe(0)
  })

  it('projects backend spending breakdown payloads into visible rows', () => {
    const payload: AccountSpendingBreakdown = {
      range: 'MTD',
      top_categories: [
        { category_id: 'food', name: 'Food', total: 7_000 },
      ],
      top_merchants: [],
      categories_total_spend: 10_000,
      merchants_total_spend: 0,
      other_categories_count: 2,
      other_merchants_count: 0,
    }

    expect(getBreakdownRows(
      payload,
      (breakdown) => breakdown.top_categories.map((category) => ({
        key: category.category_id,
        name: category.name,
        total: category.total,
        isOther: false,
      })),
      (breakdown) => breakdown.other_categories_count,
      (breakdown) => breakdown.categories_total_spend,
    )).toEqual([
      { key: 'food', name: 'Food', total: 7_000, isOther: false },
      { key: 'other', name: 'Other (2)', total: 3_000, isOther: true },
    ])
  })

  it('sizes the Other row from the total of the card it belongs to', () => {
    const payload: AccountSpendingBreakdown = {
      range: 'MTD',
      top_categories: [
        { category_id: 'food', name: 'Food', total: 7_000 },
      ],
      top_merchants: [
        { merchant_id: 'grocer', name: 'Grocer', total: 4_000 },
      ],
      categories_total_spend: 10_000,
      merchants_total_spend: 6_000,
      other_categories_count: 1,
      other_merchants_count: 1,
    }

    // Reading the categories total here instead would size this Other row at 6_000
    expect(getBreakdownRows(
      payload,
      (breakdown) => breakdown.top_merchants.map((merchant) => ({
        key: merchant.merchant_id,
        name: merchant.name,
        total: merchant.total,
        isOther: false,
      })),
      (breakdown) => breakdown.other_merchants_count,
      (breakdown) => breakdown.merchants_total_spend,
    )).toEqual([
      { key: 'grocer', name: 'Grocer', total: 4_000, isOther: false },
      { key: 'other', name: 'Other (1)', total: 2_000, isOther: true },
    ])
  })

  it('explains the merchant total only where it differs from the categories total', () => {
    const payload: AccountSpendingBreakdown = {
      range: 'MTD',
      top_categories: [],
      top_merchants: [],
      categories_total_spend: 10_000,
      merchants_total_spend: 6_000,
      other_categories_count: 0,
      other_merchants_count: 0,
    }

    expect(shouldExplainMerchantsTotal(payload)).toBe(true)
    expect(shouldExplainMerchantsTotal({ ...payload, merchants_total_spend: 10_000 })).toBe(false)
    expect(shouldExplainMerchantsTotal(undefined)).toBe(false)
  })
})
