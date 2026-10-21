/**
 * Tests the credit account choice helpers, so a choice made in the dashboard credit widget saves only
 * the cards the user unchecked, and a card added while the chooser is open is never left out silently
 */
import { describe, expect, it } from 'vitest'
import type { CreditUtilizationAccount } from '@/api/dashboard'
import {
  areAllAccountsLeftOut,
  getExcludedAccountIds,
  isExclusionChanged,
  toggleExcludedAccount,
} from '@/pages/dashboard/utils/creditAccountChoice'

const CARDS: CreditUtilizationAccount[] = [
  { id: 'card-a', name: 'Card A', is_counted: true, account_type: 'credit_card', institution: null },
  { id: 'card-b', name: 'Card B', is_counted: false, account_type: 'credit_card', institution: null },
]

describe('credit account choice', () => {
  it('saves only the cards the user unchecked, so a card added meanwhile still counts', () => {
    const saved = getExcludedAccountIds(CARDS)
    expect(saved).toEqual(new Set(['card-b']))

    // Card C is opened in another tab after the chooser loaded, so the draft has never heard of it
    const draft = toggleExcludedAccount(saved, 'card-a')
    expect(draft).toEqual(new Set(['card-a', 'card-b']))
    expect(draft.has('card-c')).toBe(false)
    expect(toggleExcludedAccount(draft, 'card-a')).toEqual(saved)
  })

  it('reports a change only when the left-out cards differ from the saved ones', () => {
    expect(isExclusionChanged(new Set(['card-b']), new Set(['card-b']))).toBe(false)
    expect(isExclusionChanged(new Set(['card-b']), new Set())).toBe(true)
    expect(isExclusionChanged(new Set(['card-b']), new Set(['card-a']))).toBe(true)
  })

  it('tells a user who left every card out from one with no cards or some counted', () => {
    expect(areAllAccountsLeftOut([{ ...CARDS[0], is_counted: false }, CARDS[1]])).toBe(true)
    expect(areAllAccountsLeftOut(CARDS)).toBe(false)
    expect(areAllAccountsLeftOut([])).toBe(false)
  })
})
