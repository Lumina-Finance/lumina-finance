/**
 * Covers how a runway in months is written, so a rough figure never promises more time than there is
 */
import { describe, expect, it } from 'vitest'
import { formatCompactRunway } from '@/utils/runway'

describe('compact runway', () => {
  it('rounds months down', () => {
    expect(formatCompactRunway(4.9)).toBe('≈ 4 mths')
  })

  it('rounds a year and a half down to the half year', () => {
    expect(formatCompactRunway(23.9)).toBe('≈ 1.5 yrs')
  })

  it('rounds longer runways down to the year', () => {
    expect(formatCompactRunway(35.9)).toBe('≈ 2 yrs')
  })
})
