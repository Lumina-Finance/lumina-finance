type LoadingRegionHeightState = {
  /** Measured height of the region's content in pixels, or null before the first measurement */
  contentHeight: number | null

  /** Whether the move back to the content's own height has finished */
  revealSettled: boolean

  shouldReduceMotion: boolean
}

/**
 * Height in pixels the region should be at, or null to leave the height to the content
 *
 * The region is never taller or shorter than what it holds, so a transition starts at the height
 * the section already had. What holding a height buys is the move: the rows arrive behind the
 * concealed content well before the reveal, and following them from a height rather than from
 * `auto` is what lets the box grow into them instead of landing in one frame. It stops holding
 * once the reveal has settled, so later changes are the content's business again
 */
export function getLoadingRegionHeight({
  contentHeight,
  revealSettled,
  shouldReduceMotion,
}: LoadingRegionHeightState): number | null {
  if (shouldReduceMotion || contentHeight === null || revealSettled) return null

  // A region holding nothing would otherwise clip its own spinner away, so a height of zero is
  // left to the content rather than held
  return contentHeight > 0 ? contentHeight : null
}

/**
 * Reports the content's height now and each time it changes, until the returned function stops it
 *
 * By default the height is the box on screen, read a frame after each change. With `readsLayoutHeight`
 * it is the layout height instead. A dialogue still scaling in does not shrink that height. The observer
 * reports only layout changes, so a height read part way through that entrance would be held short
 * of the content, clipping it, until the content next changed size. Observing also reports the height
 * the content already has. That is the first one held
 */
export function observeContentHeight(
  element: HTMLElement,
  onHeight: (height: number) => void,
  readsLayoutHeight: boolean,
): () => void {
  if (readsLayoutHeight) {
    const observer = new ResizeObserver(([entry]) => onHeight(entry.borderBoxSize[0].blockSize))
    observer.observe(element)
    return () => observer.disconnect()
  }

  let frameId: number | null = null
  const updateHeight = () => {
    if (frameId !== null) window.cancelAnimationFrame(frameId)
    frameId = window.requestAnimationFrame(() => {
      frameId = null
      onHeight(element.getBoundingClientRect().height)
    })
  }

  updateHeight()
  const observer = new ResizeObserver(updateHeight)
  observer.observe(element)

  return () => {
    if (frameId !== null) window.cancelAnimationFrame(frameId)
    observer.disconnect()
  }
}
