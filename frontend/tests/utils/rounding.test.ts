/**
 * Tests the shared rounding helpers, so a share of an amount rounds in the direction its figure calls
 * for from whole minor units, and an exact value is never moved by a floating-point quotient
 */
import { describe, expect, it } from 'vitest'
import { divideRounded, getRoundedPercent } from '@/utils/rounding'

describe('rounded division', () => {
  it('rounds a negative quotient by its signed value', () => {
    expect(divideRounded(-5, 2, 'down')).toBe(-3)
    expect(divideRounded(-5, 2, 'up')).toBe(-2)
    expect(divideRounded(5, 2, 'down')).toBe(2)
    expect(divideRounded(5, 2, 'up')).toBe(3)
  })

  it('leaves an exact quotient alone', () => {
    expect(divideRounded(-6, 2, 'up')).toBe(-3)
    expect(divideRounded(6, 2, 'down')).toBe(3)
  })
})

describe('rounded percent', () => {
  it('rounds a share up or down', () => {
    expect(getRoundedPercent(1, 3, 'up')).toBe(34)
    expect(getRoundedPercent(1, 3, 'down')).toBe(33)
    expect(getRoundedPercent(1, 3, 'up', 1)).toBe(33.4)
    expect(getRoundedPercent(1, 3, 'down', 1)).toBe(33.3)
  })

  it('keeps an exact share whole where a float quotient would tip it over', () => {
    // 0.07 * 100 is 7.000000000000001 in floating point, which would round up to 8
    expect(getRoundedPercent(7, 100, 'up')).toBe(7)
    expect(getRoundedPercent(29, 100, 'down')).toBe(29)
  })
})
