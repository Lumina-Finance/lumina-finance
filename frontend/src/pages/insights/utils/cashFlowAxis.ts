const MAX_AXIS_INTERVALS = 6
const MIN_AXIS_STEP_MINOR_UNITS = 1
// Round steps, as fractions of a power of ten, which the tick amounts read cleanly in
const STEP_FRACTIONS = [1, 2, 2.5, 5, 10]

/**
 * Even axis ticks that cover every net flow and zero and end just past the tallest and lowest bars,
 * so the trend fills the chart instead of leaving empty room above it
 *
 * The step is the smallest round one that keeps the axis within a handful of intervals. Amounts are
 * in minor units, so the step is a whole number of them and never drops below one, which keeps two
 * ticks from printing the same amount, and a range of a few units gets fewer ticks
 *
 * @param nets - Net flow of each bar, in minor units
 * @returns Ascending tick values from at or below the lowest bar to at or above the highest
 */
export function getCashFlowAxisTicks(nets: number[]): number[] {
  const high = Math.max(0, ...nets)
  const low = Math.min(0, ...nets)
  const smallestStep = Math.max((high - low) / MAX_AXIS_INTERVALS, MIN_AXIS_STEP_MINOR_UNITS)
  const magnitude = 10 ** Math.floor(Math.log10(smallestStep))
  const step = STEP_FRACTIONS
    .map((fraction) => fraction * magnitude)
    .find((candidate) => Number.isInteger(candidate) && candidate >= smallestStep)!
  const first = Math.floor(low / step)
  // A range of all zeros still gets a second tick, so the axis has a height
  const last = Math.max(Math.ceil(high / step), first + 1)
  return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step)
}
