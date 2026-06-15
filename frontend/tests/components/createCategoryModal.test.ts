/**
 * Tests create-category modal helper behaviour so focus changes preserve keyboard-only field navigation
 */
import { describe, expect, it } from 'vitest'
import { getNextModalFieldTabStop } from '@/components/modal/focus'
import { CREATE_CATEGORY_FIELD_IDS } from '@/components/reference-modals/createCategoryConstants'

describe('create category modal helpers', () => {
  it('wraps create category modal Tab focus through field controls only', () => {
    const fieldTabStops = [
      CREATE_CATEGORY_FIELD_IDS.icon,
      CREATE_CATEGORY_FIELD_IDS.name,
      CREATE_CATEGORY_FIELD_IDS.kind,
    ]

    expect(getNextModalFieldTabStop(fieldTabStops, null, false)).toBe(CREATE_CATEGORY_FIELD_IDS.icon)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_CATEGORY_FIELD_IDS.icon, false)).toBe(CREATE_CATEGORY_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_CATEGORY_FIELD_IDS.name, false)).toBe(CREATE_CATEGORY_FIELD_IDS.kind)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_CATEGORY_FIELD_IDS.kind, false)).toBe(CREATE_CATEGORY_FIELD_IDS.icon)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_CATEGORY_FIELD_IDS.icon, true)).toBe(CREATE_CATEGORY_FIELD_IDS.kind)
  })
})
