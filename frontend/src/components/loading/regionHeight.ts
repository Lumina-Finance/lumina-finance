type LoadingRegionHeightState = {
  /** Whether the spinner is on screen */
  loadingVisible: boolean

  /** Measured height of the region's content in pixels, or null before the first measurement */
  contentHeight: number | null

  /** Whether the move back to the content's own height has finished */
  revealSettled: boolean

  shouldReduceMotion: boolean
}

/**
 * Height in pixels the region should be at, or null to leave the height to the content
 *
 * The region is never taller or shorter than what it holds, so a load starts at the height the
 * section already had. What the held height buys is the move: the rows arrive behind the concealed
 * content well before the reveal, and following them from a height rather than from `auto` is what
 * lets the box grow into them instead of landing in one frame. It stops holding a height once the
 * reveal has settled, so later changes are the content's business again
 */
export function getLoadingRegionHeight({
  loadingVisible,
  contentHeight,
  revealSettled,
  shouldReduceMotion,
}: LoadingRegionHeightState): number | null {
  if (shouldReduceMotion || contentHeight === null) return null
  if (!loadingVisible && revealSettled) return null

  // A region holding nothing would otherwise clip its own spinner away, so a height of zero is
  // left to the content rather than held
  return contentHeight > 0 ? contentHeight : null
}
