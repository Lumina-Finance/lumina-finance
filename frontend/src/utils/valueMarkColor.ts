export type ValueMarkTone = 'positive' | 'accent' | 'negative'

// Every shape that reads a value out as a colour draws from this pair, so a bar on one page and a
// bar on another cannot end up different greens. Text keeps --app-positive and --app-negative,
// which carry the contrast a figure needs against the page behind it
const VALUE_MARK_COLORS: Record<ValueMarkTone, string> = {
  positive: 'var(--app-chart-positive)',
  accent: 'var(--app-accent)',
  negative: 'var(--app-chart-negative)',
}

/**
 * Resolves the colour a chart mark, meter or progress bar is drawn in
 *
 * The green and the red hold their shade in both themes. The amber does not, since it is the same
 * accent the rest of the interface uses
 */
export function getValueMarkColor(tone: ValueMarkTone) {
  return VALUE_MARK_COLORS[tone]
}
