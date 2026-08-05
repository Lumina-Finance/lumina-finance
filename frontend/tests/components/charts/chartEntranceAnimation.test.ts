/**
 * Covers the entrance-animation policy every recharts chart shares
 *
 * These tests catch regressions where a chart keeps animating after its entrance, which makes
 * pointer movement repaint the plot frame by frame, or stops animating for good, which makes a
 * range or mode switch snap to its new shape instead of transitioning
 */
import { describe, expect, it } from 'vitest'
import {
  getChartDataSignature,
  resolveChartEntranceAnimation,
} from '@/components/charts/useChartEntranceAnimation'

describe('chart entrance animation policy', () => {
  it('leaves recharts to decide while the entrance is armed', () => {
    expect(resolveChartEntranceAnimation({
      previousSignature: 'a',
      dataSignature: 'a',
      armed: true,
    })).toEqual({ armed: true, isAnimationActive: 'auto' })
  })

  it('holds animation off once the entrance has ended and the values are unchanged', () => {
    expect(resolveChartEntranceAnimation({
      previousSignature: 'a',
      dataSignature: 'a',
      armed: false,
    })).toEqual({ armed: false, isAnimationActive: false })
  })

  it('arms again when the drawn values change', () => {
    expect(resolveChartEntranceAnimation({
      previousSignature: 'a',
      dataSignature: 'b',
      armed: false,
    })).toEqual({ armed: true, isAnimationActive: 'auto' })
  })

  it('stays armed when the values change mid-entrance', () => {
    expect(resolveChartEntranceAnimation({
      previousSignature: 'a',
      dataSignature: 'b',
      armed: true,
    })).toEqual({ armed: true, isAnimationActive: 'auto' })
  })
})

describe('chart data signature', () => {
  it('changes when a drawn value changes', () => {
    const before = [{ net: 10 }, { net: 20 }]
    const after = [{ net: 10 }, { net: 21 }]

    expect(getChartDataSignature(before, (point) => point.net))
      .not.toBe(getChartDataSignature(after, (point) => point.net))
  })

  it('holds steady when the series is rebuilt with the same values', () => {
    const first = [{ net: 10 }, { net: 20 }]
    const second = [{ net: 10 }, { net: 20 }]

    expect(getChartDataSignature(first, (point) => point.net))
      .toBe(getChartDataSignature(second, (point) => point.net))
  })

  it('separates a point leaving the series from a value changing', () => {
    const twoPoints = [{ net: 1 }, { net: 2 }]
    const onePoint = [{ net: 12 }]

    expect(getChartDataSignature(twoPoints, (point) => point.net))
      .not.toBe(getChartDataSignature(onePoint, (point) => point.net))
  })

  it('changes when only one of several drawn values changes', () => {
    const before = [{ income: 5, expense: 3 }]
    const after = [{ income: 5, expense: 4 }]
    const readBoth = (point: { income: number, expense: number }) => `${point.income}|${point.expense}`

    expect(getChartDataSignature(before, readBoth)).not.toBe(getChartDataSignature(after, readBoth))
  })

  it('changes when a series of equal length reorders', () => {
    const before = [{ net: 1 }, { net: 2 }]
    const after = [{ net: 2 }, { net: 1 }]

    expect(getChartDataSignature(before, (point) => point.net))
      .not.toBe(getChartDataSignature(after, (point) => point.net))
  })
})
