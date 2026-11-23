/**
 * Tests the missing exchange-rate pairs a compact tooltip names, and that a combined status keeps the
 * reason a part gives for leaving amounts out. A total built from several parts once dropped it
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { FxRateIssue } from '@/api/shared/fx'
import { combineFxStatuses, formatMissingFxPairs } from '@/utils/fxStatus'

const pair = (base: string, quote: string) => ({ base, quote }) as FxRateIssue

describe('formatMissingFxPairs', () => {
  it('lists up to three pairs the way a sentence does', () => {
    expect(formatMissingFxPairs([pair('USD', 'CAD'), pair('EUR', 'CAD')])).toBe('USD/CAD and EUR/CAD')
    expect(formatMissingFxPairs([pair('USD', 'CAD'), pair('EUR', 'CAD'), pair('GBP', 'CAD')])).toBe(
      'USD/CAD, EUR/CAD and GBP/CAD',
    )
  })

  it('counts the pairs beyond the first three as one more item', () => {
    const pairs = [pair('USD', 'CAD'), pair('EUR', 'CAD'), pair('GBP', 'CAD'), pair('JPY', 'CAD')]
    expect(formatMissingFxPairs(pairs)).toBe('USD/CAD, EUR/CAD, GBP/CAD and 1 more')
  })
})

describe('combineFxStatuses', () => {
  const reason = 'This server allows no more of these'
  const states = ['none', 'complete', 'incomplete', 'unavailable'] as const
  const statuses = fc.array(
    fc.record({
      state: fc.constantFrom(...states),
      missing_pairs: fc.array(fc.record({ base: fc.constantFrom('USD', 'EUR'), quote: fc.constant('CAD') }), {
        maxLength: 2,
      }),
      withheld_reason: fc.option(fc.constantFrom(reason, 'Another sentence'), { nil: undefined }),
    }),
    { maxLength: 5 },
  )

  it('keeps the first reason any part gives, whatever state that part and the others are in, and gives none when no part has one', () => {
    fc.assert(
      fc.property(statuses, (parts) => {
        const expected = parts.find((part) => part.withheld_reason)?.withheld_reason

        expect(combineFxStatuses(parts).withheld_reason).toBe(expected)
      }),
    )
  })

  it('leaves a combination of parts with no reason as it always was', () => {
    expect(combineFxStatuses([{ state: 'none', missing_pairs: [] }, undefined, null])).toEqual({
      state: 'none',
      missing_pairs: [],
    })
  })

  it('keeps the reason of a part that used no conversion beside one that converted', () => {
    expect(
      combineFxStatuses([
        { state: 'complete', missing_pairs: [] },
        { state: 'none', missing_pairs: [], withheld_reason: reason },
      ]),
    ).toEqual({ state: 'complete', missing_pairs: [], withheld_reason: reason })
  })
})
