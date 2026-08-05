import { useCallback, useState } from 'react'

// Recharts resolves 'auto' against the reduced-motion setting itself, through a detector that
// subscribes to the media query and re-renders when it changes. Handing that value back while the
// entrance is armed keeps the preference authoritative and live, so this hook only ever takes
// animation away and never forces it on. While the preference is set recharts runs no animation and
// reports no end, so the entrance simply stays armed and ready for the day it is turned off
const ARMED_ANIMATION_VALUE = 'auto'

/** Value recharts accepts for a graphical item's `isAnimationActive` prop */
export type ChartAnimationActive = boolean | typeof ARMED_ANIMATION_VALUE

type ChartEntranceAnimation = {
  isAnimationActive: ChartAnimationActive
  onAnimationEnd: () => void
}

type ChartEntranceResolution = {
  armed: boolean
  isAnimationActive: ChartAnimationActive
}

// Separates one drawn value from the next inside a signature. The point count is written in front
// of them so a series of one string value cannot read the same as a series of several numbers
const SIGNATURE_VALUE_SEPARATOR = ','

/**
 * Builds a signature that changes when the values a chart draws change
 *
 * @param series - The points the chart draws
 * @param getValue - Reads the drawn value from one point, joining several with a separator of its
 * own where an item draws more than one
 * @returns The signature to hand {@link useChartEntranceAnimation}
 */
export function getChartDataSignature<T>(
  series: readonly T[],
  getValue: (point: T) => number | string | null | undefined,
): string {
  // Walks every point, so callers hold it behind a useMemo over the series they already derive
  return `${series.length}:${series.map(getValue).join(SIGNATURE_VALUE_SEPARATOR)}`
}

/**
 * Decides whether a chart's entrance animation should be playing
 *
 * @param previousSignature - Signature the chart last rendered with
 * @param dataSignature - Signature of the values the chart is rendering now
 * @param armed - Whether the entrance is currently allowed to play
 * @returns The armed flag to hold and the value to hand recharts
 */
export function resolveChartEntranceAnimation({
  previousSignature,
  dataSignature,
  armed,
}: {
  previousSignature: string | number
  dataSignature: string | number
  armed: boolean
}): ChartEntranceResolution {
  const nextArmed = armed || previousSignature !== dataSignature

  return {
    armed: nextArmed,
    isAnimationActive: nextArmed ? ARMED_ANIMATION_VALUE : false,
  }
}

/**
 * Plays a recharts graphical item's entrance once, then leaves it static until its values change
 *
 * Recharts keys an item's animation off the identity of the shapes it computes, and a bar or a pie
 * rebuilds those on every render, so an animated one replays its entrance whenever anything
 * re-renders the chart, pointer movement included.
 *
 * @param dataSignature - A value derived from what the chart draws, changing when those values do.
 * It has to cover everything that moves the drawn shapes, which includes a scale the reader can
 * switch and any key an ancestor remounts the plot on, not only the plotted numbers
 * @returns Props to spread onto one `Bar`, `Line`, `Area` or `Pie`
 */
export function useChartEntranceAnimation({
  dataSignature,
}: {
  dataSignature: string | number
}): ChartEntranceAnimation {
  const [armed, setArmed] = useState(true)
  const [renderedSignature, setRenderedSignature] = useState(dataSignature)

  const resolved = resolveChartEntranceAnimation({
    previousSignature: renderedSignature,
    dataSignature,
    armed,
  })

  // Compared during render rather than in an effect, because recharts commits an item's finished
  // geometry as the starting point of its next animation, so arming after new values have already
  // rendered would interpolate a shape into itself and move nothing. The comparison is held in
  // state rather than a ref so a render React discards takes it along: a ref would keep the
  // mutation while losing the queued update, leaving a chart that never arms again
  if (renderedSignature !== dataSignature) {
    setRenderedSignature(dataSignature)
    setArmed(resolved.armed)
  }

  // Recharts drives the animation from an effect that lists this callback among its dependencies,
  // so a new function on each render would tear the animation down and start it again, which is the
  // replay this hook exists to stop
  const onAnimationEnd = useCallback(() => setArmed(false), [])

  return { isAnimationActive: resolved.isAnimationActive, onAnimationEnd }
}
