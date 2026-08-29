/**
 * Which transactions a bulk edit covers, what a pending shift-click or day tick would change it to,
 * and what the panel sends once the user presses Apply.
 *
 * Every transition is a pure function of the state and the rows on screen, so the range, the anchor,
 * the pointer preview and the request body can all be checked without rendering anything.
 */
import type { Category } from '@/api/categories'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/pages/transactions/components/bulk-edit/constants'
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

  /**
   * True when every selected transaction ends up under a category that records the account on the
   * other side of a transfer, which is what decides whether the answer can be sent at all
   */
  resultingCategoriesRecordTransferTarget: boolean
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
    // Only sent where every row ends up recording one. A target picked before the category was
    // changed is otherwise still in the panel's state, invisible, and refuses the whole batch
    ...(transferTarget && choice.resultingCategoriesRecordTransferTarget
      ? {
          counterparty_account_scope: transferTarget.scope,
          counterparty_account_id: transferTarget.scope === 'tracked' ? transferTarget.accountId : null,
        }
      : {}),
  }
}

/**
 * Returns whether the edit fills in anything at all.
 *
 * Only that. Whether the server would take what it holds is a separate question, answered by
 * getBulkEditBlockers against the rows the edit covers rather than against the edit alone.
 */
export function hasBulkEditChoice(choice: BulkEditChoice): boolean {
  return Object.keys(buildBulkEditFields(choice)).length > 0
}

/** One selected transaction, as the rules about what an edit may do to it see it */
export interface SelectedTransactionFacts {
  id: string;

  /** The account it sits in, which a move changes */
  accountId: string;

  /** False for a row recorded before a merchant was required, which the server refuses to edit */
  hasMerchant: boolean;

  /** Whether its own category records the account on the other side of a transfer */
  recordsFarSide: boolean;

  /**
   * Whether it has an answer for that other side. Read off the scope rather than off the account, the
   * way the server reads it, so one recorded as going outside the tracked accounts is answered
   */
  hasFarSideRecorded: boolean;

  /** The account recorded as the other side, absent where the money went outside the tracked accounts */
  farSideAccountId: string | null;
}

/**
 * Returns whether every selected transaction ends up under a category that records the account on the
 * other side of a transfer.
 *
 * The category a row ends up with is the chosen one where the edit sets one and its own otherwise. The
 * server sends the whole batch back where one row ends up recording no other side and the request
 * carries an answer for one, so the control is offered only where every row qualifies.
 *
 * @param chosenCategory The category the edit sets, or undefined while it sets none
 * @param rows The selected transactions
 */
export function doEveryResultingCategoryRecordTransferTarget(
  chosenCategory: Category | undefined,
  rows: SelectedTransactionFacts[],
): boolean {
  if (chosenCategory) return doesChosenCategoryRecordTransferTarget(chosenCategory);
  return rows.length > 0 && rows.every((row) => row.recordsFarSide);
}

/** The selected transactions an edit would have the server refuse the whole batch over */
export interface BulkEditBlockers {
  /** Rows with no merchant recorded, which the server refuses to edit at all until one is set */
  withoutMerchant: string[];

  /** Transfers with no record of where the money went, which the edit has to answer */
  unansweredFarSide: string[];

  /** Rows that would end up recording the account they sit in as their own other side */
  ownAccountFarSide: string[];
}

/**
 * Returns the selected transactions the server would refuse, so the edit can be corrected before it is
 * confirmed rather than after.
 *
 * Each of these refuses the whole batch, and each is reachable without the user doing anything wrong:
 * a row recorded before merchants were required, a transfer recorded before the far account was, and a
 * row whose far account and own account end up the same.
 *
 * Not every refusal is modelled. A transfer pointing at an account the user can no longer open is one
 * the server alone can see, since a list fixed to one account carries no others to test against.
 *
 * @param rows The selected transactions
 * @param choice What the edit holds
 * @param chosenCategoryRecordsTransferTarget Whether the category the edit sets records the other side,
 *     or undefined while the edit sets no category and each row keeps its own
 */
export function getBulkEditBlockers(
  rows: SelectedTransactionFacts[],
  choice: BulkEditChoice,
  chosenCategoryRecordsTransferTarget: boolean | undefined,
): BulkEditBlockers {
  const sendsFarSide = choice.transferTarget !== null && choice.resultingCategoriesRecordTransferTarget;
  const chosenFarSideAccountId = sendsFarSide && choice.transferTarget?.scope === 'tracked'
    ? choice.transferTarget.accountId
    : null;

  const withoutMerchant: string[] = [];
  const unansweredFarSide: string[] = [];
  const ownAccountFarSide: string[] = [];

  for (const row of rows) {
    if (!row.hasMerchant && !choice.merchantId) withoutMerchant.push(row.id);

    const endsUpRecordingFarSide = chosenCategoryRecordsTransferTarget ?? row.recordsFarSide;
    if (!endsUpRecordingFarSide) continue;

    if (!sendsFarSide && !row.hasFarSideRecorded) {
      unansweredFarSide.push(row.id);
      continue;
    }

    const resultingFarSideAccountId = sendsFarSide ? chosenFarSideAccountId : row.farSideAccountId;
    const resultingAccountId = choice.accountId || row.accountId;
    if (resultingFarSideAccountId !== null && resultingFarSideAccountId === resultingAccountId) {
      ownAccountFarSide.push(row.id);
    }
  }

  return { withoutMerchant, unansweredFarSide, ownAccountFarSide };
}

/**
 * Returns whether the edit can be written.
 *
 * The empty case matters as much as the cap: a refetch that no longer carries the selected rows empties
 * the selection, which can happen while the edit is open.
 *
 * @param rows The selected transactions
 * @param choice What the edit holds
 * @param blockers What the server would refuse, from getBulkEditBlockers
 */
export function canApplyBulkEdit(
  rows: SelectedTransactionFacts[],
  choice: BulkEditChoice,
  blockers: BulkEditBlockers,
): boolean {
  if (rows.length === 0 || rows.length > MAX_BULK_EDIT_TRANSACTIONS) return false;
  if (!hasBulkEditChoice(choice)) return false;

  return (
    blockers.withoutMerchant.length === 0
    && blockers.unansweredFarSide.length === 0
    && blockers.ownAccountFarSide.length === 0
  );
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

  /**
   * The transactions shown under the day heading the pointer is over, or null when no heading is
   * being previewed. Held whether or not shift is down, since a day tick takes everything under one
   * heading rather than a range with a far end to aim
   */
  hoveredGroupIds: string[] | null;
}

export type BulkSelectionAction =
  | { type: 'toggle'; id: string; rows: SelectableRow[] }
  | { type: 'extend'; id: string; rows: SelectableRow[] }
  | { type: 'toggleGroup'; ids: string[]; rows: SelectableRow[] }
  | { type: 'hover'; id: string | null }
  | { type: 'hoverGroup'; ids: string[] | null }
  | { type: 'keepDisplayed'; ids: string[] }
  | { type: 'clear' };

export const emptyBulkSelection: BulkSelectionState = {
  selectedIds: new Set(),
  anchorId: null,
  baselineIds: new Set(),
  hoveredId: null,
  hoveredGroupIds: null,
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
 * Returns the transactions under one day heading that the app allows editing, in the order the
 * heading shows them.
 *
 * @param ids The transactions shown under one heading
 * @param rows Every row on screen, which is what says whether one can be edited
 */
function editableGroupIds(ids: string[], rows: SelectableRow[]): string[] {
  return ids.filter((id) => rows.find((row) => row.id === id)?.isReadOnly === false);
}

/**
 * Returns what the selection becomes when a day heading's tick is clicked, or null when the day
 * shows nothing the app allows editing and the click changes nothing.
 *
 * A day already taken whole is dropped whole, and anything else is taken. Either way the ticks in
 * other days are left as they are.
 */
export function groupResultingSelection(
  selectedIds: Set<string>,
  ids: string[],
  rows: SelectableRow[],
): Set<string> | null {
  const editable = editableGroupIds(ids, rows);
  if (editable.length === 0) return null;

  const dropsTheDay = editable.every((id) => selectedIds.has(id));
  const resulting = new Set(selectedIds);
  for (const id of editable) {
    if (dropsTheDay) resulting.delete(id);
    else resulting.add(id);
  }
  return resulting;
}

/** How a day heading is marked, read against the rows it shows that the app allows editing */
export type GroupSelectionMark = 'none' | 'some' | 'all' | 'unselectable';

/**
 * Returns how a day heading's tick is marked.
 *
 * Read against the transactions the heading shows rather than the whole calendar day, since the list
 * loads a page at a time and the last heading on screen usually stands over only part of its day.
 * Once a later page adds more of that day, a heading that read all falls back to some.
 *
 * A day showing nothing the app allows editing is unselectable rather than unticked, so the heading
 * can offer a tick that is plainly off rather than one that refuses when clicked.
 */
export function groupSelectionMark(
  ids: string[],
  rows: SelectableRow[],
  selectedIds: Set<string>,
): GroupSelectionMark {
  const editable = editableGroupIds(ids, rows);
  if (editable.length === 0) return 'unselectable';
  if (editable.every((id) => selectedIds.has(id))) return 'all';
  if (editable.some((id) => selectedIds.has(id))) return 'some';
  return 'none';
}

/**
 * Returns what the selection would become if the pending click happened, or null when nothing is
 * pending.
 *
 * This is the whole resulting set rather than only the rows a click would add, so the highlight can
 * show a row the click would drop losing its mark before anything is clicked.
 */
export function previewSelection(
  state: BulkSelectionState,
  rows: SelectableRow[],
): Set<string> | null {
  // The pointer is over a day heading or over a row, never both, so only one of these is ever set
  if (state.hoveredGroupIds !== null) {
    return groupResultingSelection(state.selectedIds, state.hoveredGroupIds, rows);
  }

  if (state.hoveredId === null) return null;
  return resultingSelection(state, state.hoveredId, rows);
}

/** Returns whether two hovered headings are the same one, so a repeated move changes no state */
function isSameGroup(current: string[] | null, next: string[] | null): boolean {
  if (current === null || next === null) return current === next;
  return current.length === next.length && current.every((id, index) => id === next[index]);
}

/** How one row is marked, once any pending shift-click or day tick is taken into account */
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
      return {
        selectedIds,
        anchorId: action.id,
        baselineIds: new Set(selectedIds),
        hoveredId: null,
        hoveredGroupIds: null,
      };
    }

    case 'extend': {
      const resulting = resultingSelection(state, action.id, action.rows);
      if (resulting === null) {
        return bulkSelectionReducer(state, { type: 'toggle', id: action.id, rows: action.rows });
      }
      return { ...state, selectedIds: resulting, hoveredId: null, hoveredGroupIds: null };
    }

    case 'toggleGroup': {
      const resulting = groupResultingSelection(state.selectedIds, action.ids, action.rows);
      if (resulting === null) return state;

      // No single row was clicked, so there is no anchor for a following shift-click to run from.
      // The baseline goes with it rather than being left behind pointing at ticks that have gone
      return {
        selectedIds: resulting,
        anchorId: null,
        baselineIds: new Set(resulting),
        hoveredId: null,
        hoveredGroupIds: null,
      };
    }

    case 'hover': {
      // A row under the pointer means no day heading is under it, so a heading preview left behind
      // goes with it. Clearing the row hover leaves the heading preview alone, since releasing shift
      // clears the row hover and a day preview never depended on shift
      const hoveredGroupIds = action.id === null ? state.hoveredGroupIds : null;
      if (state.hoveredId === action.id && state.hoveredGroupIds === hoveredGroupIds) return state;
      return { ...state, hoveredId: action.id, hoveredGroupIds };
    }

    case 'hoverGroup': {
      // A heading under the pointer means no row is under it, so a row preview left behind goes with
      // it. Without that, moving off the small tick onto the heading's own label would put the old
      // range back up over rows the pointer is nowhere near
      const hoveredId = action.ids === null ? state.hoveredId : null;
      if (isSameGroup(state.hoveredGroupIds, action.ids) && state.hoveredId === hoveredId) return state;
      return { ...state, hoveredGroupIds: action.ids, hoveredId };
    }

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
