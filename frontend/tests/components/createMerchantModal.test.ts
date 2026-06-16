/**
 * Tests create-merchant modal helper behaviour so focus changes preserve keyboard-only field navigation
 */
import { describe, expect, it } from 'vitest'
import { getNextModalFieldTabStop } from '@/components/modal/focus'
import { CREATE_MERCHANT_FIELD_IDS } from '@/components/reference-modals/createMerchantConstants'

describe('create merchant modal helpers', () => {
  it('wraps create merchant modal Tab focus through field controls only', () => {
    const fieldTabStops = [
      CREATE_MERCHANT_FIELD_IDS.name,
      CREATE_MERCHANT_FIELD_IDS.defaultCategory,
    ]

    expect(getNextModalFieldTabStop(fieldTabStops, null, false)).toBe(CREATE_MERCHANT_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_MERCHANT_FIELD_IDS.name, false)).toBe(CREATE_MERCHANT_FIELD_IDS.defaultCategory)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_MERCHANT_FIELD_IDS.defaultCategory, false)).toBe(CREATE_MERCHANT_FIELD_IDS.name)
    expect(getNextModalFieldTabStop(fieldTabStops, CREATE_MERCHANT_FIELD_IDS.name, true)).toBe(CREATE_MERCHANT_FIELD_IDS.defaultCategory)
  })
})
