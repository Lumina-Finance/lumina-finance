const TARGET_AXIS_INTERVALS = 4
const MIN_AXIS_STEP_MINOR_UNITS = 1

/**
 * Even axis ticks that cover every net flow and zero, so the top label sits one step above the
 * tallest bar like the others rather than at an arbitrary figure
 *
 * Amounts are in minor units, so the step never drops below one of them, which keeps two ticks from
 * printing the same amount, and a range of a few units gets fewer ticks
 *
 * @param nets - Net flow of each bar, in minor units
 * @returns Ascending tick values from at or below the lowest bar to at or above the highest
 */
export function getCashFlowAxisTicks(nets: number[]): number[] {
  const high = Math.max(0, ...nets)
  const low = Math.min(0, ...nets)
  const rawStep = Math.max((high - low) / TARGET_AXIS_INTERVALS, MIN_AXIS_STEP_MINOR_UNITS)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const fraction = rawStep / magnitude
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude
  const first = Math.floor(low / step)
  // A range of all zeros still gets a second tick, so the axis has a height
  const last = Math.max(Math.ceil(high / step), first + 1)
  return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step)
}
