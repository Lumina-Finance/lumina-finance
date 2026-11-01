import type { SpendingRange } from '@/api/dashboard'
import { AVERAGE_PERIOD_LIMIT_BY_RANGE, PREVIOUS_PERIOD_LABEL_BY_RANGE } from '@/pages/dashboard/constants/ranges'

/**
 * What the spending comparison's average toggle holds: whether the average is shown on this visit, and
 * whether the user asked to keep it on across visits
 */
export type SpendingAverageToggleState = {
  on: boolean
  kept: boolean
}

const AVERAGE_TOGGLE_NAME = 'Compare with your average'

/** Said on a toast when the average failed to load, since the toggle then reads off and the previous period shows */
export const AVERAGE_FAILED_MESSAGE = "Your average couldn't load. Click AVG to try again."

/**
 * The words on the average toggle: a short accessible name, and the tooltip that says only what a click and
 * a hold do. Holding a kept toggle stops keeping it, so the tooltip names the hold that applies. After a
 * failed load the toggle reads off, so the tooltip says the average failed and that a click tries again
 */
export function getAverageToggleTexts(kept: boolean, range: SpendingRange, failed = false) {
  const unit = PREVIOUS_PERIOD_LABEL_BY_RANGE[range]
  const compare = `Click to compare with your average ${unit}`
  // The current period and a period without spending are left out, so the count is of whole periods with spending
  const worked = `The average is calculated from the last ${AVERAGE_PERIOD_LIMIT_BY_RANGE[range]} ${unit}s, leaving out any without spending.`
  return {
    name: kept ? `${AVERAGE_TOGGLE_NAME}, kept on` : AVERAGE_TOGGLE_NAME,
    tooltip: failed
      ? "Your average couldn't load. Click to try again."
      : kept
        ? `${compare}, and hold to stop using it as the default. ${worked}`
        : `${compare}, and hold to use it as the default. ${worked}`,
  }
}

/**
 * A click turns the average on or off for this visit and leaves a kept choice as it was, so a kept
 * toggle is back on at the next visit
 */
export function getStateAfterClick(state: SpendingAverageToggleState): SpendingAverageToggleState {
  return { ...state, on: !state.on }
}

/**
 * A long press on a kept toggle stops keeping it and leaves the visit as it is. Anywhere else it turns the
 * average on and keeps it
 *
 * @param canKeep - Whether the keep could be saved. Where the browser refuses storage, the average still
 *   turns on for this visit but is not kept, since it would not be there at the next one
 */
export function getStateAfterLongPress(
  state: SpendingAverageToggleState,
  canKeep: boolean,
): SpendingAverageToggleState {
  if (state.kept) return { ...state, kept: false }
  return { on: true, kept: canKeep }
}
