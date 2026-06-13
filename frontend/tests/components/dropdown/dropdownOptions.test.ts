/**
 * Tests dropdown option helpers so refactors catch broken search results, grouped indexes, selected-option fallbacks, and create-action labels before shared menus render
 */
import { describe, expect, it } from 'vitest'
import {
  getCreateNewLabel,
  getEffectiveHighlightedIndex,
  getGroupedDropdownOptions,
  getSelectedDropdownOption,
  getVisibleDropdownOptions,
} from '@/components/dropdown/options'
import type { DropdownOption } from '@/components/dropdown/Dropdown'

const options: DropdownOption[] = [
  { value: 'chequing', label: 'Chequing', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'visa', label: 'Visa', group: 'Liabilities' },
]

describe('dropdown option helpers', () => {
  it('keeps a selected option visible when the current page of options does not include it', () => {
    expect(getSelectedDropdownOption(options, { value: 'loaded-later', label: 'Loaded later' }, 'loaded-later')).toEqual({
      value: 'loaded-later',
      label: 'Loaded later',
    })
    expect(getSelectedDropdownOption(options, undefined, 'missing')).toBeUndefined()
  })

  it('filters visible options and hides stale options while loading when requested', () => {
    expect(getVisibleDropdownOptions({
      filterOptions: true,
      hideOptionsWhileLoading: false,
      options,
      searchable: true,
      searchText: 'sav',
      showLoading: false,
    })).toEqual([{ value: 'savings', label: 'Savings', group: 'Assets' }])

    expect(getVisibleDropdownOptions({
      filterOptions: true,
      hideOptionsWhileLoading: true,
      options,
      searchable: true,
      searchText: 'sav',
      showLoading: true,
    })).toEqual([])
  })

  it('groups adjacent options while preserving flat indexes for keyboard navigation', () => {
    expect(getGroupedDropdownOptions(options)).toEqual([
      {
        label: 'Assets',
        items: [
          { option: options[0], flatIndex: 0 },
          { option: options[1], flatIndex: 1 },
        ],
      },
      {
        label: 'Liabilities',
        items: [{ option: options[2], flatIndex: 2 }],
      },
    ])
    expect(getGroupedDropdownOptions([{ value: 'plain', label: 'Plain' }])).toBeNull()
  })

  it('keeps highlighted indexes inside the visible option range when auto-highlight is enabled', () => {
    expect(getEffectiveHighlightedIndex(true, -1, 3)).toBe(0)
    expect(getEffectiveHighlightedIndex(true, 7, 3)).toBe(0)
    expect(getEffectiveHighlightedIndex(true, 2, 3)).toBe(2)
    expect(getEffectiveHighlightedIndex(false, -1, 3)).toBe(-1)
  })

  it('resolves create labels from static text, formatters, and default wording', () => {
    expect(getCreateNewLabel(undefined, '')).toBe('Create new')
    expect(getCreateNewLabel(undefined, 'Groceries')).toBe('Create "Groceries"')
    expect(getCreateNewLabel('Add account', 'Groceries')).toBe('Add account')
    expect(getCreateNewLabel((query) => `Add ${query}`, 'Groceries')).toBe('Add Groceries')
  })
})

