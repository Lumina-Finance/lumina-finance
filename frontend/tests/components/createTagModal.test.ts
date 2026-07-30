/**
 * Tests create-tag modal helper behaviour so focus changes preserve keyboard-only field navigation
 */
import { describe, expect, it } from 'vitest'
import { getNextTabStop } from '@/components/modal/focus'
import { CREATE_TAG_FIELD_IDS } from '@/components/reference-modals/createTagConstants'

describe('create tag modal helpers', () => {
  it('wraps create tag modal Tab focus through field controls only', () => {
    const fieldTabStops = [CREATE_TAG_FIELD_IDS.name]

    expect(getNextTabStop(fieldTabStops, null, false)).toBe(CREATE_TAG_FIELD_IDS.name)
    expect(getNextTabStop(fieldTabStops, CREATE_TAG_FIELD_IDS.name, false)).toBe(CREATE_TAG_FIELD_IDS.name)
    expect(getNextTabStop(fieldTabStops, CREATE_TAG_FIELD_IDS.name, true)).toBe(CREATE_TAG_FIELD_IDS.name)
  })
})
