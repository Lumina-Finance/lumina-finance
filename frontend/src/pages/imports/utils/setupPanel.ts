/**
 * What the import page's setup panel, which holds the data source and the files, is doing
 *
 * It is collapsed by the user's choice or by a file arriving. While collapsed on desktop it shows
 * when the pointer is on it, focus is in it, or its contents hold it open with a field that has an
 * error, a dropdown that is open or a date calendar that is open, and none of these changes whether it is collapsed
 */
export type SetupPanelState = {
  isCollapsed: boolean
  isPointerInside: boolean
  isFocusInside: boolean
  isHeldByContent: boolean

  /** Set when the files went while the panel lay over the steps, so it takes its place in the layout without a slide */
  isPlacedAtOnce: boolean
}

export type SetupPanelEvent =
  | { type: 'file-staged'; isDesktop: boolean; isFocusInside: boolean }
  | { type: 'files-cleared'; isDesktop: boolean }
  | { type: 'toggled' }
  | { type: 'expand-requested' }
  | { type: 'pointer-entered' }
  | { type: 'pointer-left' }
  | { type: 'focus-entered' }
  | { type: 'focus-left' }
  | { type: 'content-hold-changed'; isHeldByContent: boolean }

export const INITIAL_SETUP_PANEL_STATE: SetupPanelState = {
  isCollapsed: false,
  isPointerInside: false,
  isFocusInside: false,
  isHeldByContent: false,
  isPlacedAtOnce: false,
}

/**
 * Moves the panel on for one event
 *
 * A file collapses the panel on desktop alone, where it can be brought back by hovering. Elsewhere
 * only the caret does that, so a file arriving never takes the files away from a user who has
 * nothing to hover with. The pointer that chose the file is forgotten, so the panel goes at once
 * and comes back only when the pointer returns. Focus is read again when the file arrives, since
 * collapsing over it would drop the user's place and what they are typing onto the page, and the
 * panel stays until focus leaves. The caret forgets pointer and focus, so it collapses a panel they
 * are still on. Clearing the files brings the panel back everywhere, since an empty import has
 * nothing else to show, and at once when it was already lying over the steps, since its sections
 * are then where they belong and only the steps have to give way
 */
export function reduceSetupPanel(state: SetupPanelState, event: SetupPanelEvent): SetupPanelState {
  switch (event.type) {
    case 'file-staged':
      return event.isDesktop
        ? {
            ...state,
            isCollapsed: true,
            isPointerInside: false,
            isFocusInside: event.isFocusInside,
            isPlacedAtOnce: false,
          }
        : { ...state, isPlacedAtOnce: false }
    case 'files-cleared':
      return {
        ...state,
        isCollapsed: false,
        isPlacedAtOnce: state.isCollapsed && isSetupPanelOpen(state, event.isDesktop),
      }
    case 'toggled':
      return {
        ...state,
        isCollapsed: !state.isCollapsed,
        isPointerInside: false,
        isFocusInside: false,
        isPlacedAtOnce: false,
      }
    case 'expand-requested':
      // The page has news for the panel's sections, so it opens the way the caret opens it, and does
      // nothing to a panel that is open. Pointer and focus stay as they are
      return state.isCollapsed ? { ...state, isCollapsed: false, isPlacedAtOnce: false } : state
    case 'pointer-entered':
      return { ...state, isPointerInside: true }
    case 'pointer-left':
      return { ...state, isPointerInside: false }
    case 'focus-entered':
      return { ...state, isFocusInside: true }
    case 'focus-left':
      return { ...state, isFocusInside: false }
    case 'content-hold-changed':
      return { ...state, isHeldByContent: event.isHeldByContent }
  }
}

/**
 * Whether the panel's contents are on screen, with hovering, focus and what its contents hold it open
 * for counting only on desktop, where the panel collapses by itself
 */
export function isSetupPanelOpen(state: SetupPanelState, isDesktop: boolean): boolean {
  return !state.isCollapsed || (isDesktop && (state.isPointerInside || state.isFocusInside || state.isHeldByContent))
}

/**
 * Whether the staged files are all accepted and there is at least one
 *
 * A refused file is reported on the upload card in the setup panel, so the panel is not collapsed
 * over it. Slots with no file are skipped
 */
export function hasOnlyAcceptedFiles(files: ReadonlyArray<{ error: string | null } | null>): boolean {
  const staged = files.filter((file) => file !== null)
  return staged.length > 0 && staged.every((file) => !file.error)
}
