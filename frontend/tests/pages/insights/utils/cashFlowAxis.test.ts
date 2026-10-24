/**
 * Covers the cash flow card's Y axis ticks stepping evenly from zero to one step past the tallest bar
 */
import { describe, expect, it } from 'vitest';
import { getCashFlowAxisTicks } from '@/pages/insights/utils/cashFlowAxis';

describe('getCashFlowAxisTicks', () => {
  // The axis used to end at the tallest bar's own figure, so its top label was uneven with the rest
  it('ends the axis on an even step above the tallest bar', () => {
    expect(getCashFlowAxisTicks([132_700, 40_000])).toEqual([0, 50_000, 100_000, 150_000]);
  });

  it('covers negative bars and keeps zero on the axis', () => {
    expect(getCashFlowAxisTicks([-30_000, 70_000])).toEqual([-50_000, 0, 50_000, 100_000]);
  });

  it('gives a range of all zeros an axis with a height', () => {
    expect(getCashFlowAxisTicks([0, 0])).toEqual([0, 1]);
  });

  it('never puts two ticks closer than one minor unit', () => {
    expect(getCashFlowAxisTicks([1])).toEqual([0, 1]);
    expect(getCashFlowAxisTicks([250])).toEqual([0, 100, 200, 300]);
  });
});
