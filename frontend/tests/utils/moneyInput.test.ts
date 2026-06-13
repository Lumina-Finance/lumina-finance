/**
 * Tests shared money input helpers so form fields keep live decimal editing behaviour while rejecting unsupported characters
 */
import { describe, expect, it } from 'vitest'
import {
  formatMoneyInputLive,
  sanitizeMoneyInput,
} from '@/utils/moneyInput'

describe('money input helpers', () => {
  it('removes unsupported characters while keeping one decimal separator', () => {
    expect(sanitizeMoneyInput('$1,234.5.6')).toBe('1234.56')
    expect(sanitizeMoneyInput('.99')).toBe('0.99')
  })

  it('formats live input without losing an active decimal', () => {
    expect(formatMoneyInputLive('1234')).toBe('1,234')
    expect(formatMoneyInputLive('1234.')).toBe('1,234.')
    expect(formatMoneyInputLive('1234.50')).toBe('1,234.50')
  })
})
