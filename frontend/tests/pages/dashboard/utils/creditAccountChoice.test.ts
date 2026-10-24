/**
 * Tests the credit account choice helpers, so a choice made in the dashboard credit widget saves only
 * the cards the user unchecked, and a card added while the chooser is open is never left out silently
 */
import { describe, expect, it } from 'vitest'
import type { CreditUtilizationAccount } from '@/api/dashboard'
import {
  areAllAccountsLeftOut,
  getCreditEmptyMessage,
  getExcludedAccountIds,
  isExclusionChanged,
  toggleExcludedAccount,
} from '@/pages/dashboard/utils/creditAccountChoice'
import { fxStatus } from './fixtures'

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

  it('says a rate is missing, not that no limit is set or no accounts exist, when a foreign limit has no rate', () => {
    const usdCard: CreditUtilizationAccount = { ...CARDS[0], id: 'card-usd', name: 'USD card' }
    const noLimit = { credit_limit_total: 0, credit_used: 0, fx_status: fxStatus, accounts: [usdCard] }
    const usdToCad = { base: 'USD', quote: 'CAD' }

    // The only counted card has a USD limit and no rate, so the total is 0 (FX unavailable)
    expect(getCreditEmptyMessage({ ...noLimit, fx_status: { state: 'unavailable', missing_pairs: [usdToCad] } }))
      .toEqual({ message: 'An exchange rate is missing for USD/CAD', needsAttention: true })

    // A CAD card with no limit beside it changes nothing (FX incomplete)
    expect(getCreditEmptyMessage({ ...noLimit, accounts: [CARDS[0], usdCard], fx_status: { state: 'incomplete', missing_pairs: [usdToCad] } }))
      .toEqual({ message: 'An exchange rate is missing for USD/CAD', needsAttention: true })

    // Four pairs show three and the count of the rest
    const pairs = ['USD', 'EUR', 'GBP', 'JPY'].map((base) => ({ base, quote: 'CAD' }))
    expect(getCreditEmptyMessage({ ...noLimit, fx_status: { state: 'unavailable', missing_pairs: pairs } }).message)
      .toBe('An exchange rate is missing for USD/CAD, EUR/CAD, GBP/CAD and 1 more')
  })

  it('says no limit is set when counted cards have none and no conversion failed', () => {
    expect(getCreditEmptyMessage({ credit_limit_total: 0, credit_used: 0, fx_status: fxStatus, accounts: CARDS }))
      .toEqual({ message: 'No credit limit set', needsAttention: false })
  })

  it('says there are no credit accounts when the user has none or counts none', () => {
    const none = { credit_limit_total: 0, credit_used: 0, fx_status: fxStatus, accounts: [] }
    const expected = { message: 'No credit accounts', needsAttention: false }
    expect(getCreditEmptyMessage(none)).toEqual(expected)
    expect(getCreditEmptyMessage(undefined)).toEqual(expected)
    expect(getCreditEmptyMessage({ ...none, accounts: [CARDS[1]] })).toEqual(expected)
  })
})
