/**
 * Tests the one place that decides how a negative amount is written, which style each kind of amount
 * takes today
 */
import { describe, expect, it } from 'vitest'
import { getNegativeStyle } from '@/utils/negativeStyle'

describe('negative style', () => {
  it('writes a held negative in brackets and a moved negative with a true minus', () => {
    expect(getNegativeStyle('held')).toBe('brackets')
    expect(getNegativeStyle('moved')).toBe('minus')
  })
})
