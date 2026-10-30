/**
 * Whether an inclusive range of YYYY-MM-DD dates touches more than one calendar year, which is when a
 * month on a chart's time axis can repeat and the January label has to carry the year
 */
export function crossesCalendarYear(fromDate: string, toDate: string): boolean {
  return fromDate.slice(0, 4) !== toDate.slice(0, 4)
}

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
export function getYearAxisLabelIndexes(marksYear: boolean[], stride: number): number[] {
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
 * The bars the X axis labels on a range over two calendar years, as the `key` of each, or nothing
 * when no bar marks the year, which leaves the chart's own thinning in charge
 *
 * @param buckets - Each bar's axis label, the unique key the axis plots it by and whether the label carries the year
 * @param plotWidth - The width the labels are drawn along, in pixels, or 0 before it is measured
 */
export function getYearAxisTicks<Key>(
  buckets: { label: string; key: Key; marksYear: boolean }[],
  plotWidth: number,
): Key[] | undefined {
  if (plotWidth <= 0 || !buckets.some((bucket) => bucket.marksYear)) return undefined
  const longest = (marksYear: boolean) => {
    const lengths = buckets.filter((bucket) => bucket.marksYear === marksYear).map((bucket) => bucket.label.length)
    return Math.max(0, ...lengths)
  }
  // The tightest neighbours are a year label beside a bare one, whose centres must clear half of each plus the gap
  const needed = ((longest(true) + longest(false)) / 2) * X_AXIS_CHARACTER_PX + X_AXIS_LABEL_GAP_PX
  const stride = Math.ceil(needed / (plotWidth / buckets.length))
  return getYearAxisLabelIndexes(
    buckets.map((bucket) => bucket.marksYear),
    stride,
  ).map((index) => buckets[index].key)
}
