/**
 * Which transactions a bulk edit covers, what a pending shift-click would change it to, and what
 * the panel sends once the user presses Apply.
 *
 * Every transition is a pure function of the state and the rows on screen, so the range, the anchor,
 * the pointer preview and the request body can all be checked without rendering anything.
 */
import type { Category } from '@/api/categories'
import {
  BALANCE_ADJUSTMENT_CATEGORY_NAME,
  doesTransferRecordCounterpartyAccount,
} from '@/utils/transfers'

/**
 * Returns whether a chosen category records the account on the other side of a transfer.
 *
 * Reads the rule the server reads, which turns on the category's name alone. The transaction
 * modal's own field hooks add a test for whether the category is a built-in one, so following
 * those would offer a control for a request the server refuses.
 *
 * @param category The category the panel has chosen, or undefined while none is chosen
 */
export function doesChosenCategoryRecordTransferTarget(category: Category | undefined): boolean {
  if (!category) return false
  return doesTransferRecordCounterpartyAccount(
    category.kind,
    category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME,
  )
}

/**
 * Returns the accounts a selection can move to.
 *
 * A move keeps each transaction's stored exchange rate, and almost no imported transaction has one,
 * so an account in another currency would refuse the whole batch. A selection spanning currencies
 * can move nowhere at all, which the panel says rather than leaving a refusal to be discovered.
 *
 * @param accounts Every account the list knows about
 * @param selectedCurrencies Currencies of the selected transactions, deduplicated
 */
export function getBulkMoveTargets<T extends { is_archived?: boolean; closed_at?: string | null; currency?: string }>(
  accounts: T[],
  selectedCurrencies: string[],
): T[] {
  if (selectedCurrencies.length !== 1) return []
  return accounts.filter(
    (account) => !account.is_archived && !account.closed_at && account.currency === selectedCurrencies[0],
  )
}

/** Where the other side of a transfer sits, or null when the panel has not been asked */
export type TransferTargetChoice =
  | { scope: 'tracked'; accountId: string }
  | { scope: 'outside' }

/** What the panel holds, before it becomes a request */
export interface BulkEditChoice {
  categoryId: string
  merchantId: string
  tagIds: string[]
  accountId: string
  date: string

  /** The text typed into the note box, which is empty both before typing and after clearing */
  note: string

  /** True when the note box is meant to take the note off rather than set one */
  clearsNote: boolean

  transferTarget: TransferTargetChoice | null

  /** True when the chosen category records the account on the other side of a transfer */
  categoryRecordsTransferTarget: boolean
}

/** The details a bulk request carries, which is everything in it except the transactions it covers */
export interface BulkEditFields {
  category_id?: string
  merchant_id?: string
  add_tag_ids?: string[]
  account_id?: string
  dt?: string
  notes?: string | null
  counterparty_account_id?: string | null
  counterparty_account_scope?: 'tracked' | 'outside' | null
}

/**
 * Turns what the panel holds into the details a request carries.
 *
 * A control left alone is left out rather than sent empty, because the server applies a field it
 * was sent and leaves out a field it was not. That is also why clearing the note sends null rather
 * than an empty string.
 */
export function buildBulkEditFields(choice: BulkEditChoice): BulkEditFields {
  const { categoryId, merchantId, tagIds, accountId, date, note, clearsNote, transferTarget } = choice

  return {
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(merchantId ? { merchant_id: merchantId } : {}),
    ...(tagIds.length ? { add_tag_ids: tagIds } : {}),
    ...(accountId ? { account_id: accountId } : {}),
    ...(date ? { dt: date } : {}),
    ...(clearsNote ? { notes: null } : note ? { notes: note } : {}),
    // Only sent under a category that records one. A target picked before the category was changed
    // is otherwise still in the panel's state, invisible, and refuses the whole batch
    ...(transferTarget && choice.categoryRecordsTransferTarget
      ? {
          counterparty_account_scope: transferTarget.scope,
          counterparty_account_id: transferTarget.scope === 'tracked' ? transferTarget.accountId : null,
        }
      : {}),
  }
}

/**
 * Returns whether the panel holds something the server would accept.
 *
 * Not derived from the fields alone: a category that records the other side of a transfer is a
 * field, but on its own it is a request the server refuses, so it does not count until the transfer
 * target is answered.
 */
export function hasBulkEditChoice(choice: BulkEditChoice): boolean {
  if (choice.categoryRecordsTransferTarget && choice.transferTarget === null) return false
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
