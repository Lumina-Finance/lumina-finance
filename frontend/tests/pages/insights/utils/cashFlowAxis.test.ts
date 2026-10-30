/**
 * Covers the cash flow card's Y axis ticks stepping evenly and ending just past the tallest and lowest bars
 */
import { describe, expect, it } from 'vitest'
import { getCashFlowAxisTicks } from '@/pages/insights/utils/cashFlowAxis'

describe('getCashFlowAxisTicks', () => {
  // The axis topped out at 1,500.00 for a 1,020.00 bar, which left a third of the chart empty
  it('ends the axis just above the tallest bar, not a whole coarse step past it', () => {
    expect(getCashFlowAxisTicks([102_000, 40_000])).toEqual([0, 20_000, 40_000, 60_000, 80_000, 100_000, 120_000])
    expect(getCashFlowAxisTicks([132_700, 40_000])).toEqual([0, 25_000, 50_000, 75_000, 100_000, 125_000, 150_000])
  })

  it('ends the axis just below the lowest bar when every bar is negative', () => {
    expect(getCashFlowAxisTicks([-102_000, -40_000])).toEqual([
      -120_000, -100_000, -80_000, -60_000, -40_000, -20_000, 0,
    ])
  })

  it('covers negative bars and keeps zero on the axis', () => {
    expect(getCashFlowAxisTicks([-30_000, 70_000])).toEqual([-40_000, -20_000, 0, 20_000, 40_000, 60_000, 80_000])
  })

  it('gives a range of all zeros an axis with a height', () => {
    expect(getCashFlowAxisTicks([0, 0])).toEqual([0, 1])
  })

  it('never puts two ticks closer than one minor unit', () => {
    expect(getCashFlowAxisTicks([1])).toEqual([0, 1])
    expect(getCashFlowAxisTicks([250])).toEqual([0, 50, 100, 150, 200, 250])
  })
})
