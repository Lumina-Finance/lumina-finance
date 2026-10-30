/** Marks an element a message must not cover, such as the button that finishes the page's task */
export const TOAST_KEEP_CLEAR_SELECTOR = '[data-toast-keep-clear]'

/** Room left between a message that has moved up and the element it moved clear of */
const TOAST_CLEAR_GAP_PX = 12

/** Room kept between a message that has moved up and the top of the window */
const TOAST_TOP_MARGIN_PX = 8

export type ToastBox = { top: number; bottom: number; left: number; right: number }

const overlaps = (a: ToastBox, b: ToastBox) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/**
 * How far a message in its usual place has to move up to stop covering the elements marked to be
 * kept clear, 0 when it covers none of them
 *
 * A message with nothing under it stays where it is. One that has moved can land on another marked
 * element, so it moves on until it is clear of all of them, and it never leaves the top of the window
 *
 * @param toast - The message's box in its usual place
 * @param keepClear - Boxes of the elements to keep clear, in the same coordinates
 * @returns Pixels to move the message up
 */
export function getToastLift(toast: ToastBox, keepClear: ToastBox[]): number {
  const highestLift = Math.max(0, toast.top - TOAST_TOP_MARGIN_PX)
  let lift = 0
  for (let pass = 0; pass <= keepClear.length; pass += 1) {
    const lifted = { ...toast, top: toast.top - lift, bottom: toast.bottom - lift }
    const covered = keepClear.filter((box) => overlaps(lifted, box))
    if (covered.length === 0) break
    const clearOfAll = Math.min(...covered.map((box) => box.top)) - TOAST_CLEAR_GAP_PX
    lift = Math.min(highestLift, toast.bottom - clearOfAll)
  }
  return lift
}
