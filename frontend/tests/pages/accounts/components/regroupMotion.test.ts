/**
 * Tests the motion the account list regroups with, so changing the grouping keeps gliding over 300ms
 * and swaps at once for a user who prefers reduced motion
 */
import { describe, expect, it } from 'vitest'
import { getRegroupTransition } from '@/pages/accounts/components/regroupMotion'

describe('regrouping motion', () => {
  it('glides over 300ms, and swaps at once when the user prefers reduced motion', () => {
    expect(getRegroupTransition(false)).toEqual({ duration: 0.3, ease: [0.22, 1, 0.36, 1] })
    expect(getRegroupTransition(null)).toEqual({ duration: 0.3, ease: [0.22, 1, 0.36, 1] })
    expect(getRegroupTransition(true)).toEqual({ duration: 0 })
  })
})
