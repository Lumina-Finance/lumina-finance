/**
 * What a key press asks the drop-down to do, with the state it lands on already worked out
 *
 * `none` still has to say whether the key is swallowed. A key the drop-down ignores but does not
 * swallow reaches the browser, which scrolls the page on an arrow and activates the focused pill on
 * Space or Enter, so ignoring a key and letting it through are different answers.
 */
export type DropdownKeyAction =
  | { kind: 'none'; swallow: boolean }
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

  // Nothing selectable lies that way, so the highlight holds where it is, unless where it is cannot
  // be chosen either, which leaves it on nothing rather than on a row Enter would refuse
  return canCommitOption(optionDisabled, from) ? from : -1
}

/**
 * Reports whether an option exists at this index and can be chosen
 *
 * @param index - Position among the visible options, which is -1 when nothing is highlighted
 */
export function canCommitOption(optionDisabled: readonly boolean[], index: number): boolean {
  return index >= 0 && index < optionDisabled.length && !optionDisabled[index]
}

/**
 * Picks the option to highlight as the menu opens, preferring the current value and falling back to
 * the first one that can be chosen
 *
 * Both the keyboard and a click on the pill open through here, so a menu opened either way starts on
 * the same option.
 */
export function getOpeningHighlight(optionDisabled: readonly boolean[], selectedIndex: number): number {
  if (canCommitOption(optionDisabled, selectedIndex)) return selectedIndex

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
  switch (key) {
    case ' ':
      // Space typed into the search field is a space. From the pill it opens the menu, and while the
      // menu is open it is swallowed rather than left to activate the pill and close it again
      if (!fromTrigger) return { kind: 'none', swallow: false }
      if (open) return { kind: 'none', swallow: true }
      return { kind: 'open', highlightedIndex: getOpeningHighlight(optionDisabled, selectedIndex) }

    case 'ArrowDown':
      if (!open) {
        return { kind: 'open', highlightedIndex: stepToEnabledOption(optionDisabled, -1, 1) }
      }
      return { kind: 'move', highlightedIndex: stepToEnabledOption(optionDisabled, highlightedIndex, 1) }

    case 'ArrowUp':
      // Swallowed even with the menu closed, so an arrow press on a focused pill does not scroll the
      // page under it
      if (!open) return { kind: 'none', swallow: true }

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
      if (canCommitOption(optionDisabled, highlightedIndex)) {
        return { kind: 'select', index: highlightedIndex }
      }
      // Swallowed, so Enter on a row that cannot be chosen does nothing at all rather than
      // activating the pill underneath and closing the menu
      return { kind: 'none', swallow: true }

    case 'Escape':
      // Left to carry on when the menu is closed, so the modal holding this field still answers it
      return open ? { kind: 'close' } : { kind: 'none', swallow: false }

    default:
      return { kind: 'none', swallow: false }
  }
}
