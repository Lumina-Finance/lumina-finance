/**
 * Guards the phone filter sheet's Apply button, which is held off while the draft holds what is already
 * applied: a list in another order is the same list, a missing list is an empty one, and any real
 * change in a selection, an amount bound or a date makes Apply live again
 */
import { describe, expect, it } from 'vitest'
import { isSameSelection } from '@/components/list-controls/sameSelection'
import { isFilterPatchApplied } from '@/components/transactions/utils/filterDraft'

describe('isSameSelection', () => {
  it('ignores order and treats a missing list as empty', () => {
    expect(isSameSelection(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(isSameSelection(undefined, [])).toBe(true)
    expect(isSameSelection(['a'], ['a', 'b'])).toBe(false)
    expect(isSameSelection(['a', 'b'], ['a', 'c'])).toBe(false)
  })
})

describe('isFilterPatchApplied', () => {
  const applied = { category_id: ['c1', 'c2'], tag_id: ['t1'], tag_match: 'any' as const, from_date: '2026-10-01', min_amount: 500, amount_currency: 'USD' }

  it('is true for the draft the applied filters seed', () => {
    expect(isFilterPatchApplied({ ...applied, category_id: ['c2', 'c1'], account_id: [], merchant_id: [] }, applied)).toBe(true)
  })

  it('is false once any selection, bound or date differs', () => {
    expect(isFilterPatchApplied({ ...applied, category_id: ['c1'] }, applied)).toBe(false)
    expect(isFilterPatchApplied({ ...applied, to_date: '2026-10-31' }, applied)).toBe(false)
    expect(isFilterPatchApplied({ ...applied, min_amount: 600 }, applied)).toBe(false)
    expect(isFilterPatchApplied({ ...applied, tag_match: 'all' }, applied)).toBe(false)
    expect(isFilterPatchApplied({ ...applied, currency: 'CAD' }, applied)).toBe(false)
  })

  it('reads the tag match only while tags are chosen', () => {
    expect(isFilterPatchApplied({ tag_id: [], tag_match: undefined }, { tag_match: 'any' })).toBe(true)
  })
})
