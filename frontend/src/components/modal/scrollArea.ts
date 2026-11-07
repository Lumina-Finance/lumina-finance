// Room left between a revealed control and the edge of the area it scrolls in, more than a focus ring
// takes, so the ring isn't cut off
const REVEAL_GAP_PX = 8

/**
 * Walks up from a node to the first ancestor, up to the boundary, that can scroll vertically, so a
 * caller knows which element moves the node and where its scroll boundaries are
 */
export function findScrollableAncestor(start: Node, boundary: HTMLElement): HTMLElement | null {
  let node = start instanceof HTMLElement ? start : start.parentElement
  while (node && node !== boundary.parentElement) {
    const overflowY = window.getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node
    if (node === boundary) break
    node = node.parentElement
  }
  return null
}

/**
 * Scrolls the nearest area around an element that scrolls just far enough to show the element whole,
 * for a control focused without the browser's own scroll. That scroll would move the page behind a modal too
 */
export function revealInScrollArea(element: HTMLElement): void {
  const area = element.parentElement && findScrollableAncestor(element.parentElement, document.body)
  if (!area) return

  const areaBounds = area.getBoundingClientRect()
  const bounds = element.getBoundingClientRect()
  if (bounds.top < areaBounds.top + REVEAL_GAP_PX) {
    area.scrollTop -= areaBounds.top + REVEAL_GAP_PX - bounds.top
  } else if (bounds.bottom > areaBounds.bottom - REVEAL_GAP_PX) {
    area.scrollTop += bounds.bottom - (areaBounds.bottom - REVEAL_GAP_PX)
  }
}
