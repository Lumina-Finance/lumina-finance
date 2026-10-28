/**
 * Tests the missing exchange-rate pairs a compact tooltip names
 */
import { describe, expect, it } from 'vitest'
import type { FxRateIssue } from '@/api/shared/fx'
import { formatMissingFxPairs } from '@/utils/fxStatus'

const pair = (base: string, quote: string) => ({ base, quote }) as FxRateIssue

describe('formatMissingFxPairs', () => {
  it('lists up to three pairs the way a sentence does', () => {
    expect(formatMissingFxPairs([pair('USD', 'CAD'), pair('EUR', 'CAD')])).toBe('USD/CAD and EUR/CAD')
    expect(formatMissingFxPairs([pair('USD', 'CAD'), pair('EUR', 'CAD'), pair('GBP', 'CAD')])).toBe('USD/CAD, EUR/CAD and GBP/CAD')
  })

  it('counts the pairs beyond the first three as one more item', () => {
    const pairs = [pair('USD', 'CAD'), pair('EUR', 'CAD'), pair('GBP', 'CAD'), pair('JPY', 'CAD')]
    expect(formatMissingFxPairs(pairs)).toBe('USD/CAD, EUR/CAD, GBP/CAD and 1 more')
  })
})
