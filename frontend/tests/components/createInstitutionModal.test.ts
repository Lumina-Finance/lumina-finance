/**
 * Tests create-institution modal helper behaviour so focus changes preserve keyboard-only field navigation
 */
import { describe, expect, it } from 'vitest'
import { getNextModalFieldTabStop } from '@/components/modal/focus'
import { CREATE_INSTITUTION_FIELD_IDS } from '@/components/reference-modals/createInstitutionConstants'

describe('create institution modal helpers', () => {
  it('wraps create institution modal Tab focus through field controls only', () => {
    const fieldTabStops = [
      CREATE_INSTITUTION_FIELD_IDS.name,
      CREATE_INSTITUTION_FIELD_IDS.country,
      CREATE_INSTITUTION_FIELD_IDS.website,
    ]

    expect(getNextModalFieldTabStop(fieldTabStops, null, false)).toBe(CREATE_INSTITUTION_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_INSTITUTION_FIELD_IDS.name, false)).toBe(CREATE_INSTITUTION_FIELD_IDS.country)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_INSTITUTION_FIELD_IDS.country, false)).toBe(CREATE_INSTITUTION_FIELD_IDS.website)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_INSTITUTION_FIELD_IDS.website, false)).toBe(CREATE_INSTITUTION_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_INSTITUTION_FIELD_IDS.name, true)).toBe(CREATE_INSTITUTION_FIELD_IDS.website)
  })
})
