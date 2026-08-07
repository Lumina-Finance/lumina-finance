type LoadingRegionHeightState = {
  /** Whether the spinner is on screen */
  loadingVisible: boolean

  /** Measured height of the region's content in pixels, or null before the first measurement */
  contentHeight: number | null

  /** Height the region holds while the spinner is up, so a load with no rows behind it has room */
  loadingMinHeight: number

  /** Whether the move back to the content's own height has finished */
  revealSettled: boolean

  shouldReduceMotion: boolean
}

/**
 * Height in pixels the region should be at, or null to leave the height to the content
 *
 * The rows arrive behind the concealed content part way through a load, well before the reveal, so
 * the region follows the content up while the spinner is still on screen and the growth is animated
 * rather than landing in one frame. It goes back to the content's own height as the spinner leaves,
 * which is what shrinks the box when a search comes back with fewer rows than the loading height,
 * and then stops holding a height at all so later changes are the content's business again
 */
export function getLoadingRegionHeight({
  loadingVisible,
  contentHeight,
  loadingMinHeight,
  revealSettled,
  shouldReduceMotion,
}: LoadingRegionHeightState): number | null {
  if (shouldReduceMotion || contentHeight === null) return null
  if (!loadingVisible && revealSettled) return null

  const held = loadingVisible ? Math.max(loadingMinHeight, contentHeight) : contentHeight

  // A region holding nothing would otherwise clip its own spinner away, so a height of zero is
  // left to the content rather than held
  return held > 0 ? held : null
}
