const MAX_AXIS_INTERVALS = 6
const MIN_AXIS_STEP_MINOR_UNITS = 1
// Round steps, as fractions of a power of ten, which the tick amounts read cleanly in
const STEP_FRACTIONS = [1, 2, 2.5, 5, 10]

/**
 * The bars whose labels the X axis writes on a range over two calendar years, which Recharts' own
 * thinning would not keep: it drops the January label that marks where the year turns
 *
 * Labels sit every `stride` bars counted from the first bar that marks the year, so the steps are even.
 * Every bar that marks the year is kept, and any other label closer to one than `stride` is dropped
 *
 * @param marksYear - For each bar, whether its label carries the year
 * @param stride - How many bars apart two labels must be for both to fit
 * @returns The indexes of the bars to label, ascending
 */
export function getCashFlowXAxisLabelIndexes(marksYear: boolean[], stride: number): number[] {
  const step = Math.max(1, Math.floor(stride))
  const anchor = marksYear.indexOf(true)
  const kept: number[] = []
  marksYear.forEach((marks, index) => {
    const onGrid = (index - anchor) % step === 0
    const fitsBesideYears = marksYear.every((other, otherIndex) => !other || Math.abs(otherIndex - index) >= step)
    if (marks || (onGrid && fitsBesideYears)) kept.push(index)
  })
  return kept
}

// Roughly what one character of an X axis label takes at the 12px tick font (CHART_X_AXIS_TICK_FONT_SIZE),
// and the gap kept beside a label. Estimates, since the labels are chosen before they are drawn
const X_AXIS_CHARACTER_PX = 7
const X_AXIS_LABEL_GAP_PX = 16

/**
 * The bars the X axis labels on a range over two calendar years, as the `rangeLabel` of each, or nothing
 * when no bar marks the year, which leaves the chart's own thinning in charge
 *
 * @param buckets - Each bar's axis label, its unique range label and whether the label carries the year
 * @param plotWidth - The width the labels are drawn along, in pixels, or 0 before it is measured
 */
export function getCashFlowXAxisTicks(
  buckets: { label: string; rangeLabel: string; marksYear: boolean }[],
  plotWidth: number,
): string[] | undefined {
  if (plotWidth <= 0 || !buckets.some((bucket) => bucket.marksYear)) return undefined
  const longest = (marksYear: boolean) => {
    const lengths = buckets.filter((bucket) => bucket.marksYear === marksYear).map((bucket) => bucket.label.length)
    return Math.max(0, ...lengths)
  }
  // The tightest neighbours are a year label beside a bare one, whose centres must clear half of each plus the gap
  const needed = ((longest(true) + longest(false)) / 2) * X_AXIS_CHARACTER_PX + X_AXIS_LABEL_GAP_PX
  const stride = Math.ceil(needed / (plotWidth / buckets.length))
  return getCashFlowXAxisLabelIndexes(
    buckets.map((bucket) => bucket.marksYear),
    stride,
  ).map((index) => buckets[index].rangeLabel)
}

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
  const step = STEP_FRACTIONS.map((fraction) => fraction * magnitude).find(
    (candidate) => Number.isInteger(candidate) && candidate >= smallestStep,
  )!
  const first = Math.floor(low / step)
  // A range of all zeros still gets a second tick, so the axis has a height
  const last = Math.max(Math.ceil(high / step), first + 1)
  return Array.from({ length: last - first + 1 }, (_, index) => (first + index) * step)
}
