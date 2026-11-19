/**
 * Tests the shared rounding helpers, so a share of an amount rounds in the direction its figure calls
 * for from whole minor units, and an exact value is never moved by a floating-point quotient
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { divideRounded, getChangePercent, getRoundedPercent } from '@/utils/rounding'

// The remainder step adds the divisor to a remainder below it, so a divisor up to half the largest
// exact integer keeps every step exact. No amount a user holds comes near it
const MAX_EXACT_DIVISION_OPERAND = Math.floor(Number.MAX_SAFE_INTEGER / 2)

// The most decimal places any share is shown with
const MAX_PERCENT_FRACTION_DIGITS = 2

// A share comes back divided by its decimal places, and multiplying it back into whole steps stays
// exact only well below the largest exact integer
const MAX_EXACT_SHARE_STEPS = 2 ** 50

// A share multiplies its part by 100 and by its decimal places before dividing, so amounts stay small
// enough that the product, and so every step it reads back, stays exact
const MAX_SHARE_AMOUNT = Math.floor(MAX_EXACT_SHARE_STEPS / (100 * 10 ** MAX_PERCENT_FRACTION_DIGITS))

const divisionOperands = fc.integer({ min: -MAX_EXACT_DIVISION_OPERAND, max: MAX_EXACT_DIVISION_OPERAND })
const divisors = fc.integer({ min: 1, max: MAX_EXACT_DIVISION_OPERAND })
const shareParts = fc.integer({ min: -MAX_SHARE_AMOUNT, max: MAX_SHARE_AMOUNT })
const shareWholes = fc.integer({ min: 1, max: MAX_SHARE_AMOUNT })
const fractionDigits = fc.integer({ min: 0, max: MAX_PERCENT_FRACTION_DIGITS })

describe('change in percent', () => {
  it('rounds a rise and a fall by the direction given, working from the signed change', () => {
    // 1,001 against 1,000 is +0.1%, and 995 against 1,000 is -0.5%
    expect(getChangePercent(1_001, 1_000, 'up')).toBe(1)
    expect(getChangePercent(1_001, 1_000, 'down')).toBe(0)
    expect(getChangePercent(995, 1_000, 'up')).toBe(0)
    expect(getChangePercent(995, 1_000, 'down')).toBe(-1)
  })

  it('has no change to give when there is nothing to compare with', () => {
    expect(getChangePercent(500, 0, 'up')).toBeNull()
    expect(getChangePercent(500, -100, 'down')).toBeNull()
  })
})

describe('rounded division', () => {
  it('rounds down to the whole number at or below the signed quotient and up to the one at or above it', () => {
    fc.assert(
      fc.property(divisionOperands, divisors, (numerator, denominator) => {
        // Checked in big integers, since the products here can pass the largest exact number
        const exact = BigInt(numerator)
        const divisor = BigInt(denominator)
        const down = BigInt(divideRounded(numerator, denominator, 'down'))
        const up = BigInt(divideRounded(numerator, denominator, 'up'))

        expect(down * divisor <= exact && exact < (down + 1n) * divisor).toBe(true)
        expect(up).toBe(down * divisor === exact ? down : down + 1n)
      }),
    )
  })
})

describe('rounded percent', () => {
  it('never rounds a share up below the exact share or down above it, landing on the nearest step that way', () => {
    fc.assert(
      fc.property(shareParts, shareWholes, fractionDigits, (part, whole, digits) => {
        const scale = 10 ** digits
        const steps = (percent: number) => BigInt(Math.round(percent * scale))
        // The exact share in steps is exactShare / whole, kept as a fraction so nothing rounds
        const exactShare = BigInt(part) * 100n * BigInt(scale)
        const divisor = BigInt(whole)
        const up = steps(getRoundedPercent(part, whole, 'up', digits))
        const down = steps(getRoundedPercent(part, whole, 'down', digits))

        expect(up * divisor >= exactShare && (up - 1n) * divisor < exactShare).toBe(true)
        expect(down * divisor <= exactShare && (down + 1n) * divisor > exactShare).toBe(true)
      }),
    )
  })

  it('keeps an exact share whole where a float quotient would tip it over', () => {
    // 0.07 * 100 is 7.000000000000001 in floating point, which would round up to 8
    expect(getRoundedPercent(7, 100, 'up')).toBe(7)
    expect(getRoundedPercent(29, 100, 'down')).toBe(29)
  })
})
