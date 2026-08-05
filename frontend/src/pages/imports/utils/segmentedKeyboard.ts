/** What a key press does to a segmented control's selection */
export type SegmentedControlKeyAction =
  | { kind: 'none' }
  | { kind: 'move'; index: number }

const NO_ACTION: SegmentedControlKeyAction = { kind: 'none' }
const FORWARD_KEYS = new Set(['ArrowRight', 'ArrowDown'])
const BACKWARD_KEYS = new Set(['ArrowLeft', 'ArrowUp'])

/**
 * Says which option a key press moves a segmented control to, or that the key is not one it handles
 *
 * A control announcing itself as a set of radio buttons promises the arrow keys move between them
 * and that the set holds one stop in the tab order, so the promise has to be kept rather than left
 * to Tab alone. Moving wraps at both ends, and selection follows the movement, which is how a radio
 * group behaves everywhere else
 *
 * @param key - The pressed key, as the keyboard event reports it
 * @param selectedIndex - The option currently selected, or -1 while none is
 * @param count - How many options the control holds
 */
export function getSegmentedControlKeyAction(
  key: string,
  selectedIndex: number,
  count: number,
): SegmentedControlKeyAction {
  if (count === 0) return NO_ACTION
  if (key === 'Home') return { kind: 'move', index: 0 }
  if (key === 'End') return { kind: 'move', index: count - 1 }

  // With nothing selected yet, moving either way enters the set from the end it came from rather
  // than jumping to whichever option happens to sit beside index zero
  if (FORWARD_KEYS.has(key)) {
    return { kind: 'move', index: selectedIndex < 0 ? 0 : (selectedIndex + 1) % count }
  }

  if (BACKWARD_KEYS.has(key)) {
    return { kind: 'move', index: selectedIndex < 0 ? count - 1 : (selectedIndex - 1 + count) % count }
  }

  return NO_ACTION
}
