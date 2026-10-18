/**
 * Tests that a transaction amount carries its sign except at zero, which moved nothing
 */
import { describe, expect, it } from 'vitest'
import { signTransactionAmount } from '@/utils/signedTransactionAmount'

describe('signTransactionAmount', () => {
  it.each([
    [1, '$5.00', '+$5.00'],
    [-1, '$5.00', '-$5.00'],
    [0, '$0.00', '$0.00'],
  ] as const)('signs %s as %s', (sign, magnitude, expected) => {
    expect(signTransactionAmount(sign, magnitude)).toBe(expected)
  })
})
