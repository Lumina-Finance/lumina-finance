/**
 * Which transactions a bulk edit covers, and what a pending shift-click would change it to.
 *
 * Every transition is a pure function of the state and the rows on screen, so the range, the anchor
 * and the pointer preview can be checked without rendering anything.
 */

/** What the bar holds, before it becomes a request */
export interface BulkEditChoice {
  categoryId: string
  merchantId: string
  tagIds: string[]
}

/** The fields a bulk request carries, which is everything in it except the transactions it covers */
export interface BulkEditFields {
  category_id?: string
  merchant_id?: string
  add_tag_ids?: string[]
}

/**
 * Turns what the bar holds into the fields a request carries.
 *
 * A control left alone is left out rather than sent empty, since an empty value would read as a
 * change to make.
 */
export function buildBulkEditFields({ categoryId, merchantId, tagIds }: BulkEditChoice): BulkEditFields {
  return {
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(merchantId ? { merchant_id: merchantId } : {}),
    ...(tagIds.length ? { add_tag_ids: tagIds } : {}),
  }
}

/** Whether the bar holds anything to apply, which is what an apply needs before it can run */
export function hasBulkEditChoice(choice: BulkEditChoice): boolean {
  return Object.keys(buildBulkEditFields(choice)).length > 0
}

/** One row as the selection sees it: an identifier, and whether the app allows editing it */
export interface SelectableRow {
  id: string;
  isReadOnly: boolean;
}

export interface BulkSelectionState {
  /** Transactions the user has ticked */
  selectedIds: Set<string>;

  /** The row a range runs from, set by the last click made without shift */
  anchorId: string | null;

  /**
   * The ticks as they stood when the anchor was set. A shift-click rebuilds from these, which is
   * what lets a second one re-aim the far end and drop the rows the first one took, while leaving
   * a tick made before the anchor in place
   */
  baselineIds: Set<string>;

  /** The row the pointer is over while shift is held, or null when nothing is being previewed */
  hoveredId: string | null;
}

export type BulkSelectionAction =
  | { type: 'toggle'; id: string; rows: SelectableRow[] }
  | { type: 'extend'; id: string; rows: SelectableRow[] }
  | { type: 'hover'; id: string | null }
  | { type: 'keepDisplayed'; ids: string[] }
  | { type: 'clear' };

export const emptyBulkSelection: BulkSelectionState = {
  selectedIds: new Set(),
  anchorId: null,
  baselineIds: new Set(),
  hoveredId: null,
};

/**
 * Returns the editable rows lying between two rows on screen, both ends included.
 *
 * Order comes from the rows as they appear rather than from dates or identifiers, so a range means
 * what the user sees it mean. A row the app does not allow editing is stepped over.
 */
function spanBetween(rows: SelectableRow[], anchorId: string, targetId: string): string[] {
  const anchorIndex = rows.findIndex((row) => row.id === anchorId);
  const targetIndex = rows.findIndex((row) => row.id === targetId);
  if (anchorIndex === -1 || targetIndex === -1) return [];

  const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  return rows
    .slice(start, end + 1)
    .filter((row) => !row.isReadOnly)
    .map((row) => row.id);
}

/**
 * Returns what the selection becomes when a shift-click lands on a row, or null with no anchor set.
 */
export function resultingSelection(
  state: BulkSelectionState,
  targetId: string,
  rows: SelectableRow[],
): Set<string> | null {
  if (state.anchorId === null) return null;

  const resulting = new Set(state.baselineIds);
  for (const id of spanBetween(rows, state.anchorId, targetId)) resulting.add(id);
  return resulting;
}

/**
 * Returns what the selection would become if the pending shift-click happened, or null when nothing
 * is pending.
 *
 * This is the whole resulting set rather than only the rows a click would add, so the highlight can
 * show a row the click would drop losing its mark before anything is clicked.
 */
export function previewSelection(
  state: BulkSelectionState,
  rows: SelectableRow[],
): Set<string> | null {
  if (state.hoveredId === null) return null;
  return resultingSelection(state, state.hoveredId, rows);
}

/** How one row is marked, once any pending shift-click is taken into account */
export type RowSelectionMark = 'none' | 'selected' | 'pending';

/**
 * Returns how a row is marked while a preview may be up.
 *
 * With a preview up the row is marked against the set the click would produce, so a ticked row the
 * click would drop is marked none rather than staying selected.
 */
export function rowSelectionMark(
  id: string,
  selectedIds: Set<string>,
  preview: Set<string> | null,
): RowSelectionMark {
  if (preview === null) return selectedIds.has(id) ? 'selected' : 'none';
  if (!preview.has(id)) return 'none';
  return selectedIds.has(id) ? 'selected' : 'pending';
}

/**
 * Applies one selection change.
 */
export function bulkSelectionReducer(
  state: BulkSelectionState,
  action: BulkSelectionAction,
): BulkSelectionState {
  switch (action.type) {
    case 'toggle': {
      // Whether a row can be ticked is decided here rather than by each caller, so no route into
      // the state can put a row the app will not edit into the selection
      if (action.rows.find((row) => row.id === action.id)?.isReadOnly !== false) return state;

      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(action.id)) selectedIds.delete(action.id);
      else selectedIds.add(action.id);

      // The clicked row becomes the anchor whichever way it went, and the ticks left behind become
      // the baseline the next range builds on
      return { selectedIds, anchorId: action.id, baselineIds: new Set(selectedIds), hoveredId: null };
    }

    case 'extend': {
      const resulting = resultingSelection(state, action.id, action.rows);
      if (resulting === null) {
        return bulkSelectionReducer(state, { type: 'toggle', id: action.id, rows: action.rows });
      }
      return { ...state, selectedIds: resulting, hoveredId: null };
    }

    case 'hover':
      if (state.hoveredId === action.id) return state;
      return { ...state, hoveredId: action.id };

    case 'keepDisplayed': {
      const displayed = new Set(action.ids);
      const selectedIds = new Set([...state.selectedIds].filter((id) => displayed.has(id)));

      // Returning the same state when nothing left the list keeps this safe to call on every settle
      if (selectedIds.size === state.selectedIds.size) return state;
      return {
        ...state,
        selectedIds,
        baselineIds: new Set([...state.baselineIds].filter((id) => displayed.has(id))),
        anchorId: state.anchorId !== null && displayed.has(state.anchorId) ? state.anchorId : null,
      };
    }

    case 'clear':
      return emptyBulkSelection;
  }
}
