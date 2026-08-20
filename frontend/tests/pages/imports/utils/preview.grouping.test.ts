/**
 * Tests how the preview list groups its rows under one date heading, since the step renders one
 * heading per run of neighbouring rows rather than one per distinct date
 */
import { describe, expect, it } from 'vitest'
import type { PreviewTransactionRow } from '@/pages/imports/types'
import { groupPreviewRowsByDate } from '@/pages/imports/utils'

/**
 * Creates a minimal preview row under the given date label, with everything else fixed
 */
function createRow(id: string, dateLabel: string): PreviewTransactionRow {
  return {
    id,
    accountInstitution: null,
    accountName: 'Checking',
    category: undefined,
    currency: 'CAD',
    dateLabel,
    transaction: {
      id: `txn-${id}`,
      created_by_user_id: 'user-1',
      account_id: 'account-1',
      dt: '2026-01-01',
      merchant_id: null,
      merchant_name: null,
      category_id: '',
      amount: -1000,
      account_amount: -1000,
      base_currency_amount: -1000,
      currency: 'CAD',
      fx_rate: null,
      notes: null,
      counterparty_account_id: null,
      counterparty_account_scope: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      tag_ids: [],
      tags: [],
    },
  }
}

describe('grouping preview rows by date', () => {
  // The function groups runs of neighbouring rows, and a regression turning it into one group per
  // distinct date would collapse this into two groups and reorder the user's preview
  it('starts a new group when a date repeats after another date breaks the run', () => {
    const rows = [createRow('r1', 'A'), createRow('r2', 'B'), createRow('r3', 'A')]

    const groups = groupPreviewRowsByDate(rows)

    expect(groups).toHaveLength(3)
    expect(groups.map((group) => group.dateLabel)).toEqual(['A', 'B', 'A'])
  })

  it('keeps a run of neighbouring rows sharing a date in one group', () => {
    const rows = [createRow('r1', 'A'), createRow('r2', 'A'), createRow('r3', 'B')]

    const groups = groupPreviewRowsByDate(rows)

    expect(groups).toHaveLength(2)
    expect(groups[0].rows).toHaveLength(2)
    expect(groups[1].rows).toHaveLength(1)
  })

  it('returns nothing for no rows', () => {
    expect(groupPreviewRowsByDate([])).toEqual([])
  })
})
