/**
 * What a key press asks the drop-down to do, with the state it lands on already worked out
 */
export type DropdownKeyAction =
  | { kind: 'none' }
  | { kind: 'open'; highlightedIndex: number }
  | { kind: 'move'; highlightedIndex: number }
  | { kind: 'select'; index: number }
  | { kind: 'close' }

interface DropdownKeyParams {
  /** Space opens the menu only from the pill, since inside the search field it types a space */
  fromTrigger: boolean

  /** The index the list is actually showing as highlighted, after any automatic first highlight */
  highlightedIndex: number

  key: string
  open: boolean

  /** One entry per visible option, so its length is also the option count */
  optionDisabled: readonly boolean[]

  /** Where the current value sits among the visible options, or -1 when it is not among them */
  selectedIndex: number
}

/**
 * Finds the next selectable option in one direction, stopping at the end of the list rather than wrapping
 *
 * @param from - Index to start from, which may be -1 when nothing is highlighted yet
 * @param step - 1 to move down the list, -1 to move up
 * @returns The index landed on, which is the starting index when every option beyond it is disabled
 */
function stepToEnabledOption(
  optionDisabled: readonly boolean[],
  from: number,
  step: number,
): number {
  for (let index = from + step; index >= 0 && index < optionDisabled.length; index += step) {
    if (!optionDisabled[index]) return index
  }

  return from
}

/**
 * Picks the option to highlight as the menu opens, preferring the current value and falling back to
 * the first one that can be chosen
 */
function getOpeningHighlight(optionDisabled: readonly boolean[], selectedIndex: number): number {
  const selectable = selectedIndex >= 0
    && selectedIndex < optionDisabled.length
    && !optionDisabled[selectedIndex]

  if (selectable) return selectedIndex

  return stepToEnabledOption(optionDisabled, -1, 1)
}

/**
 * Resolves a key press against the drop-down's current state
 *
 * Holds the whole keyboard policy so it can be tested without a DOM: which keys open the menu, where
 * the highlight lands, and which key commits a choice.
 */
export function getDropdownKeyAction({
  fromTrigger,
  highlightedIndex,
  key,
  open,
  optionDisabled,
  selectedIndex,
}: DropdownKeyParams): DropdownKeyAction {
  const canSelect = highlightedIndex >= 0
    && highlightedIndex < optionDisabled.length
    && !optionDisabled[highlightedIndex]

  switch (key) {
    case ' ':
      if (!fromTrigger || open) return { kind: 'none' }
      return { kind: 'open', highlightedIndex: getOpeningHighlight(optionDisabled, selectedIndex) }

    case 'ArrowDown':
      if (!open) {
        return { kind: 'open', highlightedIndex: stepToEnabledOption(optionDisabled, -1, 1) }
      }
      return { kind: 'move', highlightedIndex: stepToEnabledOption(optionDisabled, highlightedIndex, 1) }

    case 'ArrowUp':
      if (!open) return { kind: 'none' }

      // Moving up before anything is highlighted lands on the first option rather than nowhere,
      // which is where the list already puts it today
      if (highlightedIndex < 0) {
        return { kind: 'move', highlightedIndex: stepToEnabledOption(optionDisabled, -1, 1) }
      }
      return { kind: 'move', highlightedIndex: stepToEnabledOption(optionDisabled, highlightedIndex, -1) }

    case 'Enter':
      if (!open) {
        return { kind: 'open', highlightedIndex: getOpeningHighlight(optionDisabled, selectedIndex) }
      }
      return canSelect ? { kind: 'select', index: highlightedIndex } : { kind: 'none' }

    case 'Escape':
      return open ? { kind: 'close' } : { kind: 'none' }

    default:
      return { kind: 'none' }
  }
}
