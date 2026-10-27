/**
 * Guards the short form the Insights totals take when their full written form is too wide for their
 * place at the smallest size: a 16-digit total reads in millions to one decimal place, signed like
 * any amount that moved, and rounds a gain down, a loss up, an expense up and an income down
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import { formatCompactMovedCurrency, formatCompactTotalCurrency } from '@/pages/insights/utils/compactMovedMoney'

const currencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD', minor_unit_exponent: 3 },
]

describe('compact moved money', () => {
  it('signs a large gain with a plus and rounds it down to a tenth of a million', () => {
    // $12,345,678,901,234.56 in cents
    expect(formatCompactMovedCurrency(1_234_567_890_123_456, 'USD', currencies)).toBe('+≈$12,345,678.9M')
  })

  it('signs a large loss with a true minus and rounds its size up', () => {
    // $12,345,678,901,234.56 in cents: the 0.90123 million above 12,345,678 rounds up to the next tenth
    expect(formatCompactMovedCurrency(-1_234_567_890_123_456, 'USD', currencies)).toBe('−≈$12,345,679.0M')
  })

  it('reads a 16-digit amount in a three-decimal currency in millions', () => {
    // IQD 1,234,567,890,123.456 in fils
    expect(formatCompactMovedCurrency(1_234_567_890_123_456, 'IQD', currencies)).toBe('+≈IQD 1,234,567.8M')
  })

  it('leaves an amount under a million written in full, with no approximation sign', () => {
    expect(formatCompactMovedCurrency(520_000, 'USD', currencies)).toBe('+$5,200.00')
    expect(formatCompactTotalCurrency(520_000, 'USD', currencies, 'income')).toBe('$5,200.00')
  })

  it('leaves a zero total unsigned', () => {
    expect(formatCompactMovedCurrency(0, 'USD', currencies)).toBe('$0.00')
  })

  it('rounds an expense total up and an income total down, unsigned', () => {
    expect(formatCompactTotalCurrency(1_234_567_890_123_456, 'USD', currencies, 'expense')).toBe('≈$12,345,679.0M')
    expect(formatCompactTotalCurrency(1_234_567_890_123_456, 'USD', currencies, 'income')).toBe('≈$12,345,678.9M')
  })
})
