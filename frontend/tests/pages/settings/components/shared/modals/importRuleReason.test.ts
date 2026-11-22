/**
 * Covers the wording of the three "choose another, then delete" dialogues when the server's refusal names an
 * import rule, and that every other refusal leaves the wording about transactions alone
 *
 * These tests catch a dialogue that tells the reader transactions will move when a rule is what uses the
 * record, a refusal for anything else changing what the dialogue says, and the rule's name being lost
 */
import { describe, expect, it } from 'vitest'
import { getImportRuleWording } from '@/pages/settings/components/shared/modals/importRuleReason'

// The sentences the server sends for each of the three. Its own tests pin them
const RULE_REFUSALS = [
  ['merchant', 'Merchant is used by the import rule "Market"'],
  ['category', 'Category is used by the import rule "Market"'],
  ['tag', 'Tag is used by the import rule "Market"'],
] as const

const TRANSACTION_REFUSALS = [
  ['merchant', 'Merchant is referenced by existing transactions'],
  ['category', 'Category is referenced by existing transactions'],
  ['tag', 'Tag is referenced by existing transactions'],
] as const

describe('the wording for an import rule in the way', () => {
  it.each(RULE_REFUSALS)(
    'leads the %s dialogue with the server reason naming the rule, then the way forward',
    (noun, reason) => {
      const wording = getImportRuleWording(reason, noun)

      expect(wording.description).toBe(
        `${reason}. Please choose another ${noun} to take its place, then you can delete it.`,
      )
      expect(wording.title).toBeDefined()
      expect(wording.description).not.toContain('transactions')
      expect(wording.title).not.toContain('transactions')
    },
  )

  it.each(RULE_REFUSALS)(
    'says nothing is compatible to take its place for the %s, since no transactions move',
    (noun, reason) => {
      const { noReplacementReason } = getImportRuleWording(reason, noun)

      expect(noReplacementReason).toBeDefined()
      expect(noReplacementReason).not.toContain('transactions')
    },
  )

  it.each(TRANSACTION_REFUSALS)('leaves the %s dialogue as it is for a refusal about transactions', (noun, reason) => {
    expect(getImportRuleWording(reason, noun)).toEqual({})
  })

  it('leaves the dialogue as it is where no reason came with the refusal', () => {
    expect(getImportRuleWording(null, 'tag')).toEqual({})
  })
})
