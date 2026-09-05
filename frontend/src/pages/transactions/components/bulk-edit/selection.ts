/**
 * Which transactions a bulk edit covers, what a pending shift-click or day tick would change it to,
 * and what the panel sends once the user presses Apply.
 *
 * Every transition is a pure function of the state and the rows on screen, so the range, the anchor,
 * the pointer preview and the request body can all be checked without rendering anything.
 */
import type { Category } from '@/api/categories'
import type { BulkDirectionChange, BulkTransferEnd, TransactionDirection } from '@/api/transactions'
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

/**
 * Returns the accounts a transfer's ends can be set to.
 *
 * Unlike a move, an end is not held to the selection's currency: the far end only records a fact,
 * and the own end is checked against each row's own currency separately, in
 * ownSideInAnotherCurrency below.
 *
 * @param accounts Every account the list knows about
 */
export function getTransferEndTargets<T extends { is_archived?: boolean; closed_at?: string | null }>(
  accounts: T[],
): T[] {
  return accounts.filter((account) => !account.is_archived && !account.closed_at)
}

/**
 * Where one end of a transfer sits, as the panel holds it. The currency travels with a tracked
 * account so the blockers can compare it against each row without a separate account lookup;
 * buildBulkEditFields strips it before the request is sent
 */
export type TransferEndChoice =
  | { scope: 'tracked'; accountId: string; currency: string }
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

  /** Where the transfer's From end sits, or null to leave it as it is */
  transferFrom: TransferEndChoice | null

  /** Where the transfer's To end sits, or null to leave it as it is */
  transferTo: TransferEndChoice | null

  /** Which way every selected transaction should end up pointing, or null to leave each as it is */
  direction: BulkDirectionChange | null

  /**
   * True while direction came from the From and To pairing rather than from a pill the user
   * clicked, which is what decides whether the request sends transfer_direction, reaching only the
   * transfer rows, or direction, reaching every selected row
   */
  directionIsImplied: boolean

  /**
   * True while any selected row ends up under a category that records the account on the other side
   * of a transfer, which is what offers the From and To controls at all. Held beside the ends so a
   * choice made before the selection or the category changed cannot be sent once the controls have
   * gone
   */
  endsAreOffered: boolean
}

/** The details a bulk request carries, which is everything in it except the transactions it covers */
export interface BulkEditFields {
  category_id?: string
  merchant_id?: string
  add_tag_ids?: string[]
  account_id?: string
  dt?: string
  notes?: string | null
  transfer_from?: BulkTransferEnd
  transfer_to?: BulkTransferEnd
  direction?: BulkDirectionChange

  /** Which way the transfer rows in the batch should end up pointing, never sent beside direction */
  transfer_direction?: BulkDirectionChange
}

/** Turns a panel-held end choice into the shape the request sends, dropping the currency it carries */
function toBulkTransferEnd(choice: TransferEndChoice): BulkTransferEnd {
  return choice.scope === 'tracked'
    ? { scope: 'tracked', account_id: choice.accountId }
    : { scope: 'outside' }
}

/**
 * Turns what the panel holds into the details a request carries.
 *
 * A control left alone is left out rather than sent empty, because the server applies a field it
 * was sent and leaves out a field it was not. That is also why clearing the note sends null rather
 * than an empty string.
 */
export function buildBulkEditFields(choice: BulkEditChoice): BulkEditFields {
  const { categoryId, merchantId, tagIds, accountId, date, note, clearsNote } = choice
  const { transferFrom, transferTo, endsAreOffered, direction, directionIsImplied } = choice

  // An end and a move both write account_id, on whichever rows resolve to be their own, so sending
  // both would be two answers for the one column
  const sendsAnEnd = endsAreOffered && (transferFrom !== null || transferTo !== null)

  // Trimmed before the emptiness check, so a note of only spaces reads the same as one never typed
  // rather than sending whitespace the single-transaction form would refuse
  const trimmedNote = note.trim()

  return {
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(merchantId ? { merchant_id: merchantId } : {}),
    ...(tagIds.length ? { add_tag_ids: tagIds } : {}),
    ...(accountId && !sendsAnEnd ? { account_id: accountId } : {}),
    ...(date ? { dt: date } : {}),
    ...(clearsNote ? { notes: null } : trimmedNote ? { notes: trimmedNote } : {}),

    // An implied direction reaches only the transfer rows, as transfer_direction, so it cannot
    // touch the rows the ends leave alone, while a direction the user picked reaches every
    // selected row
    ...(direction && directionIsImplied ? { transfer_direction: direction } : {}),
    ...(direction && !directionIsImplied ? { direction } : {}),

    // Only sent while the controls are on screen. An end picked before the category was changed
    // away is otherwise still in the panel's state, invisible, and would refuse the whole batch
    ...(endsAreOffered && transferFrom ? { transfer_from: toBulkTransferEnd(transferFrom) } : {}),
    ...(endsAreOffered && transferTo ? { transfer_to: toBulkTransferEnd(transferTo) } : {}),
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

  /** The account it sits in, which an own end or a move would carry it out of */
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

  /** The currency the amount is denominated in */
  currency: string;

  /** Money out when its amount is negative, money in otherwise, on the server and in the browser alike */
  direction: TransactionDirection;
}

/**
 * Returns a string that changes only when a fact the implied-direction and end rules read on some
 * row changes, id included so a row swapped for another with the same facts still counts as a
 * change. `rows` itself is a new array reference on every refetch even when nothing here moved, so
 * comparing this key across renders is what tells a real change in the facts apart from that.
 *
 * Covers id, accountId, currency, recordsFarSide, hasFarSideRecorded, farSideAccountId and
 * direction, which is every field impliedDirection, endsAfterDirectionClick, resolveTransferEnds
 * and resultingDirectionFor read off a row.
 *
 * @param rows The selected transactions
 */
export function rowFactsKey(rows: SelectedTransactionFacts[]): string {
  return rows
    .map((row) =>
      [
        row.id,
        row.accountId,
        row.currency,
        row.recordsFarSide,
        row.hasFarSideRecorded,
        row.farSideAccountId ?? '',
        row.direction,
      ].join('|'),
    )
    .join(';');
}

/**
 * Returns whether any selected transaction ends up under a category that records the account on the
 * other side of a transfer.
 *
 * The category a row ends up with is the chosen one where the edit sets one and its own otherwise.
 * One row alone recording a far side is enough to offer the From and To controls, since a mixed
 * selection still has to answer for the rows that need them and leaves the rest alone.
 *
 * @param chosenCategory The category the edit sets, or undefined while it sets none
 * @param rows The selected transactions
 */
export function doesAnyResultingCategoryRecordTransferTarget(
  chosenCategory: Category | undefined,
  rows: SelectedTransactionFacts[],
): boolean {
  if (chosenCategory) return doesChosenCategoryRecordTransferTarget(chosenCategory);
  return rows.some((row) => row.recordsFarSide);
}

/** Returns whether the selection holds at least one transfer and at least one other transaction */
export function isMixedSelection(rows: SelectedTransactionFacts[]): boolean {
  return rows.some((row) => row.recordsFarSide) && rows.some((row) => !row.recordsFarSide);
}

/** One tag choice as the bulk edit panel holds it, with the label it was picked under */
export interface ChosenTagOption {
  value: string;
  label: string;
}

/**
 * Returns the chosen tags with one pick toggled: adds a tag that was not chosen and removes one
 * that was, leaving the order of the rest as it stood
 *
 * @param chosen The tags chosen so far, in the order they were added
 * @param option The tag the dropdown's pick resolved to
 */
export function toggleChosenTag(chosen: ChosenTagOption[], option: ChosenTagOption): ChosenTagOption[] {
  if (chosen.some((tag) => tag.value === option.value)) {
    return chosen.filter((tag) => tag.value !== option.value);
  }
  return [...chosen, option];
}

/** Returns the opposite of a transaction's own direction, for an edit that turns a row around */
function flipDirection(direction: TransactionDirection): TransactionDirection {
  return direction === 'debit' ? 'credit' : 'debit';
}

/**
 * Returns what a row ends up pointing, mirroring the service's resolution: the direction given
 * where it sets one, the row's own flipped where it says reverse, the row's own otherwise
 */
function resultingDirectionFor(row: SelectedTransactionFacts, direction: BulkDirectionChange | null): TransactionDirection {
  if (direction === 'reverse') return flipDirection(row.direction);
  return direction ?? row.direction;
}

/** What a row's own end and far end resolve to under an edit */
export interface ResolvedTransferEnds {
  ownEnd: TransferEndChoice | null;
  farEnd: TransferEndChoice | null;
}

/**
 * Returns what a row's own end and far end resolve to, mirroring the service's per-row resolution.
 *
 * Resulting direction decides which control answers which side: money out puts the row's own
 * account on From and the far side on To, money in reverses that. A row whose resulting category
 * records no far side ignores both ends, and an end the edit leaves unset leaves that side as it is.
 *
 * @param row The selected transaction
 * @param choice What the edit holds
 * @param endsUpRecordingFarSide Whether the row's resulting category records a far side at all
 */
export function resolveTransferEnds(
  row: SelectedTransactionFacts,
  choice: BulkEditChoice,
  endsUpRecordingFarSide: boolean,
): ResolvedTransferEnds {
  if (!endsUpRecordingFarSide) return { ownEnd: null, farEnd: null };

  return resultingDirectionFor(row, choice.direction) === 'debit'
    ? { ownEnd: choice.transferFrom, farEnd: choice.transferTo }
    : { ownEnd: choice.transferTo, farEnd: choice.transferFrom };
}

/** How many selected rows one end of a transfer edit moves into it, or only records it on */
export interface TransferEndEffect {
  /** Rows whose own account this end sets, so the row itself moves */
  moves: number;

  /** Rows whose far side this end sets, without moving the row itself */
  recordsOnly: number;
}

/** What a transfer end edit would do to the rows it covers, for the notice under each control */
export interface TransferEndEffects {
  from: TransferEndEffect;
  to: TransferEndEffect;

  /** Rows whose resulting category records no far side at all, which the ends cannot touch */
  leftAlone: number;
}

/**
 * Counts what a transfer end edit would do to each selected row.
 *
 * Each row's resulting direction decides which control answers its own side and which its far
 * side, the same way resolveTransferEnds does. A control set on its own therefore still touches
 * every transfer row: once as the move for the rows whose own side it answers, once as the record
 * for the rest. An own end set to the account the row already sits in neither moves nor records it,
 * since the row is already there and the edit changes nothing about it.
 *
 * @param rows The selected transactions
 * @param choice What the edit holds
 * @param chosenCategoryRecordsTransferTarget Whether the category the edit sets records the other
 *     side, or undefined while the edit sets no category and each row keeps its own
 */
export function countTransferEndEffects(
  rows: SelectedTransactionFacts[],
  choice: BulkEditChoice,
  chosenCategoryRecordsTransferTarget: boolean | undefined,
): TransferEndEffects {
  const effects: TransferEndEffects = {
    from: { moves: 0, recordsOnly: 0 },
    to: { moves: 0, recordsOnly: 0 },
    leftAlone: 0,
  };

  for (const row of rows) {
    const endsUpRecordingFarSide = chosenCategoryRecordsTransferTarget ?? row.recordsFarSide;
    if (!endsUpRecordingFarSide) {
      effects.leftAlone += 1;
      continue;
    }

    // Money out puts From on the row's own account and To on the far side, money in the reverse
    const fromIsOwn = resultingDirectionFor(row, choice.direction) === 'debit';
    const ownChoice = fromIsOwn ? choice.transferFrom : choice.transferTo;
    const farChoice = fromIsOwn ? choice.transferTo : choice.transferFrom;
    const ownEffect = fromIsOwn ? effects.from : effects.to;
    const farEffect = fromIsOwn ? effects.to : effects.from;

    const ownEndStaysPut = ownChoice?.scope === 'tracked' && ownChoice.accountId === row.accountId;
    if (ownChoice !== null && !ownEndStaysPut) ownEffect.moves += 1;
    if (farChoice !== null) farEffect.recordsOnly += 1;
  }

  return effects;
}

/** Where the direction pills' value came from: a pill the user clicked, or the rule reading the ends */
export type BulkDirectionSource = 'user' | 'implied';

/** The direction the panel holds, together with what set it */
export interface BulkDirectionChoice {
  value: BulkDirectionChange | null;
  source: BulkDirectionSource;
}

/**
 * Returns the direction the From and To ends imply, or null where they imply nothing.
 *
 * transfer_direction reaches only the transfer rows, so this reads the transfer rows alone, the
 * chosen category's rule where one is chosen and each row's own otherwise, and a selection with
 * none of those implies nothing. An outside end says which way the money goes on its own, the same
 * way a home end does: From set to outside implies money in, To set to outside implies money out,
 * whether or not the transfer rows share a home account, and both ends outside implies nothing.
 * Failing that, home is the one account every transfer row sits in, so a selection spanning more
 * than one account has no home and implies nothing either. From there, To resolving to home with
 * From not implies money in, since the account records its own money arriving, From resolving to
 * home with To not implies money out the same way round, and any other pairing, both ends
 * resolving to home included, implies nothing.
 *
 * @param rows The selected transactions
 * @param transferFrom Where the edit sets the From end, or null to leave it as it is
 * @param transferTo Where the edit sets the To end, or null to leave it as it is
 * @param chosenCategoryRecordsTransferTarget Whether the category the edit sets records the other
 *     side, or undefined while the edit sets no category and each row keeps its own
 */
export function impliedDirection(
  rows: SelectedTransactionFacts[],
  transferFrom: TransferEndChoice | null,
  transferTo: TransferEndChoice | null,
  chosenCategoryRecordsTransferTarget: boolean | undefined,
): BulkDirectionChange | null {
  const transferRows = rows.filter((row) => chosenCategoryRecordsTransferTarget ?? row.recordsFarSide);
  if (transferRows.length === 0) return null;

  const fromIsOutside = transferFrom?.scope === 'outside';
  const toIsOutside = transferTo?.scope === 'outside';
  if (fromIsOutside && toIsOutside) return null;
  if (fromIsOutside) return 'credit';
  if (toIsOutside) return 'debit';

  const home = transferRows[0].accountId;
  if (!transferRows.every((row) => row.accountId === home)) return null;

  const toIsHome = transferTo?.scope === 'tracked' && transferTo.accountId === home;
  const fromIsHome = transferFrom?.scope === 'tracked' && transferFrom.accountId === home;

  if (toIsHome && !fromIsHome) return 'credit';
  if (fromIsHome && !toIsHome) return 'debit';
  return null;
}

/**
 * Returns the ends after a From or To pick, reverting the other end to null once both would sit
 * outside the tracked accounts, since a transfer with nothing tracked on either side has no account
 * left to check a currency against or record a real far side on
 *
 * @param from Where the From end sits after the pick
 * @param to Where the To end sits after the pick
 * @param picked Which end the user just changed
 */
export function endsAfterEndPick(
  from: TransferEndChoice | null,
  to: TransferEndChoice | null,
  picked: 'from' | 'to',
): { from: TransferEndChoice | null; to: TransferEndChoice | null } {
  const justPicked = picked === 'from' ? from : to;
  const other = picked === 'from' ? to : from;
  if (justPicked?.scope !== 'outside' || other?.scope !== 'outside') return { from, to };
  return picked === 'from' ? { from, to: null } : { from: null, to };
}

/**
 * Returns the ends after a direction pill is clicked or a category change reshapes which rows are
 * transfers, reverting whichever end an outside choice would become a transfer row's own side,
 * since an own side has to be a real account for the row to sit in.
 *
 * Each transfer row resolves its own side the way the service would: the clicked direction where
 * it sets one, the row's own flipped for Reverse, the row's own for Leave as is. A selection whose
 * rows resolve to different own sides can revert both ends where each is outside and is some row's
 * own side.
 *
 * @param direction The direction just clicked, or the one already held while a category change is
 *     what reshaped the transfer rows
 * @param from Where the From end sits
 * @param to Where the To end sits
 * @param rows The selected transactions
 * @param chosenCategoryRecordsTransferTarget Whether the category the edit sets records the other
 *     side, or undefined while the edit sets no category and each row keeps its own
 */
export function endsAfterDirectionClick(
  direction: BulkDirectionChange | null,
  from: TransferEndChoice | null,
  to: TransferEndChoice | null,
  rows: SelectedTransactionFacts[],
  chosenCategoryRecordsTransferTarget: boolean | undefined,
): { from: TransferEndChoice | null; to: TransferEndChoice | null } {
  let nextFrom = from;
  let nextTo = to;

  for (const row of rows) {
    const endsUpRecordingFarSide = chosenCategoryRecordsTransferTarget ?? row.recordsFarSide;
    if (!endsUpRecordingFarSide) continue;

    const ownSideIsFrom = resultingDirectionFor(row, direction) === 'debit';
    if (ownSideIsFrom && nextFrom?.scope === 'outside') nextFrom = null;
    if (!ownSideIsFrom && nextTo?.scope === 'outside') nextTo = null;
  }

  return { from: nextFrom, to: nextTo };
}

/**
 * Returns what the direction pills hold after a transfer end changes.
 *
 * An implication from the new pairing of ends replaces whatever the pills held, from any source and
 * Reverse included, and is marked implied so a later change knows it was the rule and not the user
 * that set it. No implication leaves a choice the user made alone, and clears an implied one back to
 * nothing set, since the pairing that produced it no longer holds.
 *
 * @param current What the pills hold now
 * @param implied What the changed pairing of ends implies, from impliedDirection
 */
export function nextDirectionAfterEndChange(
  current: BulkDirectionChoice,
  implied: BulkDirectionChange | null,
): BulkDirectionChoice {
  if (implied !== null) return { value: implied, source: 'implied' };
  if (current.source === 'user') return current;
  return { value: null, source: 'implied' };
}

/** The selected transactions an edit would have the server refuse the whole batch over */
export interface BulkEditBlockers {
  /** Rows with no merchant recorded, which the server refuses to edit at all until one is set */
  withoutMerchant: string[];

  /** Transfers with no record of where the money went, which the edit has to answer */
  unansweredFarSide: string[];

  /** Rows that would end up recording the account they sit in as their own other side */
  ownAccountFarSide: string[];

  /** Rows whose own end would resolve to outside the tracked accounts, where only a far end may sit */
  sitsOutside: string[];

  /** Rows whose own end would resolve to an account in another currency than the row's own */
  ownSideInAnotherCurrency: string[];
}

/**
 * Returns the selected transactions the server would refuse, so the edit can be corrected before it is
 * confirmed rather than after.
 *
 * Each of these refuses the whole batch, and each is reachable without the user doing anything wrong:
 * a row recorded before merchants were required, a transfer recorded before the far account was, a row
 * whose far account and own account end up the same, an own end that would leave the row outside the
 * tracked accounts, and an own end in a currency the row does not hold. An own end that resolves to the
 * account the row already sits in is exempt from that last one, since nothing moves and the server never
 * touches the exchange rate for it; a real cross-currency move is refused here even for a row that
 * already carries a rate the server would accept, a deliberate narrowing tighter than the server's own
 * check.
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
  const withoutMerchant: string[] = [];
  const unansweredFarSide: string[] = [];
  const ownAccountFarSide: string[] = [];
  const sitsOutside: string[] = [];
  const ownSideInAnotherCurrency: string[] = [];

  // An end and a move both write account_id, on whichever rows resolve to be their own, so a stray
  // Move to account choice never actually reaches the request once an end is set, the same rule
  // buildBulkEditFields applies
  const sendsAnEnd = choice.endsAreOffered && (choice.transferFrom !== null || choice.transferTo !== null);

  for (const row of rows) {
    if (!row.hasMerchant && !choice.merchantId) withoutMerchant.push(row.id);

    const endsUpRecordingFarSide = chosenCategoryRecordsTransferTarget ?? row.recordsFarSide;
    if (!endsUpRecordingFarSide) continue;

    const { ownEnd, farEnd } = resolveTransferEnds(row, choice, endsUpRecordingFarSide);

    // Read in the order the service refuses them: an own end outside the tracked accounts, then
    // one in the wrong currency, then a far side still unanswered. Checking unanswered first would
    // tell the user to answer a far side the server would refuse over the own end regardless
    if (ownEnd?.scope === 'outside') {
      sitsOutside.push(row.id);
      continue;
    }

    // An own end that resolves to the row's own account moves nothing, so a currency mismatch here
    // is never actually written and would only tell the user to fix a move that was never happening
    const ownEndStaysPut = ownEnd?.scope === 'tracked' && ownEnd.accountId === row.accountId;
    if (ownEnd?.scope === 'tracked' && ownEnd.currency !== row.currency && !ownEndStaysPut) {
      ownSideInAnotherCurrency.push(row.id);
      continue;
    }

    if (farEnd === null && !row.hasFarSideRecorded) {
      unansweredFarSide.push(row.id);
      continue;
    }

    const resultingOwnAccountId = ownEnd?.scope === 'tracked'
      ? ownEnd.accountId
      : (!sendsAnEnd && choice.accountId ? choice.accountId : row.accountId);
    const resultingFarSideAccountId = farEnd === null
      ? row.farSideAccountId
      : farEnd.scope === 'tracked' ? farEnd.accountId : null;

    if (resultingFarSideAccountId !== null && resultingFarSideAccountId === resultingOwnAccountId) {
      ownAccountFarSide.push(row.id);
    }
  }

  return { withoutMerchant, unansweredFarSide, ownAccountFarSide, sitsOutside, ownSideInAnotherCurrency };
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
    && blockers.sitsOutside.length === 0
    && blockers.ownSideInAnotherCurrency.length === 0
  );
}

/** One row as the selection sees it: an identifier, and whether the app allows editing it */
export interface SelectableRow {
  id: string;
  isReadOnly: boolean;
}

/**
 * Returns whether a row's tick can be changed: never for a read-only row, and never to add an
 * unselected row once the limit is reached. An already selected row stays changeable at the limit,
 * since the tick still has to let it be dropped.
 *
 * @param id The row's id
 * @param selectedIds Every row currently ticked
 * @param isReadOnly Whether the app allows editing this row at all
 * @param limit How many rows one bulk edit may cover
 */
export function isRowSelectable(
  id: string,
  selectedIds: Set<string>,
  isReadOnly: boolean,
  limit: number = MAX_BULK_EDIT_TRANSACTIONS,
): boolean {
  if (isReadOnly) return false;
  if (!selectedIds.has(id) && selectedIds.size >= limit) return false;
  return true;
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

  // clearsHover is set for anything but a mouse click, such as a touch tap or a keyboard
  // activation, since only a mouse leaves a pointer resting on the heading afterward for a later
  // move to clear the preview
  | { type: 'toggleGroup'; ids: string[]; rows: SelectableRow[]; clearsHover?: boolean }
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
 *
 * Takes the span in list order until the limit is reached, so a range longer than the room left
 * simply stops rather than being refused outright.
 *
 * @param limit How many rows one bulk edit may cover
 */
export function resultingSelection(
  state: BulkSelectionState,
  targetId: string,
  rows: SelectableRow[],
  limit: number = MAX_BULK_EDIT_TRANSACTIONS,
): Set<string> | null {
  if (state.anchorId === null) return null;

  const resulting = new Set(state.baselineIds);
  for (const id of spanBetween(rows, state.anchorId, targetId)) {
    if (resulting.has(id)) continue;
    if (resulting.size >= limit) break;
    resulting.add(id);
  }
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
 * A day already taken whole is dropped whole. At the limit, a day with no room left for the rest of
 * it is dropped down to the part that made it in instead, since that part is all the click can take
 * back; a day with room left takes its rows in list order until the limit is reached. Either way the
 * ticks in other days are left as they are.
 *
 * @param limit How many rows one bulk edit may cover
 */
export function groupResultingSelection(
  selectedIds: Set<string>,
  ids: string[],
  rows: SelectableRow[],
  limit: number = MAX_BULK_EDIT_TRANSACTIONS,
): Set<string> | null {
  const editable = editableGroupIds(ids, rows);
  if (editable.length === 0) return null;

  const unselected = editable.filter((id) => !selectedIds.has(id));
  const atLimit = selectedIds.size >= limit;
  const someOfTheDayIsIn = editable.some((id) => selectedIds.has(id));

  if (unselected.length === 0 || (atLimit && someOfTheDayIsIn)) {
    const resulting = new Set(selectedIds);
    for (const id of editable) resulting.delete(id);
    return resulting;
  }
  if (atLimit) return null;

  const resulting = new Set(selectedIds);
  for (const id of unselected) {
    if (resulting.size >= limit) break;
    resulting.add(id);
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
 * can offer a tick that is plainly off rather than one that refuses when clicked. A day with none of
 * its rows ticked reads unselectable the same way once the limit leaves no room to add any of them,
 * since a click would refuse there too.
 *
 * @param limit How many rows one bulk edit may cover
 */
export function groupSelectionMark(
  ids: string[],
  rows: SelectableRow[],
  selectedIds: Set<string>,
  limit: number = MAX_BULK_EDIT_TRANSACTIONS,
): GroupSelectionMark {
  const editable = editableGroupIds(ids, rows);
  if (editable.length === 0) return 'unselectable';
  if (editable.every((id) => selectedIds.has(id))) return 'all';
  if (editable.some((id) => selectedIds.has(id))) return 'some';
  if (selectedIds.size >= limit) return 'unselectable';
  return 'none';
}

/**
 * Returns what the selection would become if the pending click happened, or null when nothing is
 * pending.
 *
 * The whole resulting set rather than only the rows a click would add, since rowSelectionMark reads
 * it to tell an unselected row the click would add from one it would leave alone. A row already
 * selected reads selected whatever the set holds for it, so the set need not distinguish a kept
 * tick from one the click would drop. Marks pending only the rows the limit leaves room for, the
 * same way the click itself would settle them.
 *
 * @param limit How many rows one bulk edit may cover
 */
export function previewSelection(
  state: BulkSelectionState,
  rows: SelectableRow[],
  limit: number = MAX_BULK_EDIT_TRANSACTIONS,
): Set<string> | null {
  // The pointer is over a day heading or over a row, never both, so only one of these is ever set
  if (state.hoveredGroupIds !== null) {
    return groupResultingSelection(state.selectedIds, state.hoveredGroupIds, rows, limit);
  }

  if (state.hoveredId === null) return null;
  return resultingSelection(state, state.hoveredId, rows, limit);
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
 * A selected row always reads selected, whatever a pending shift-click or day tick would do to it,
 * so what it reads changes only once a click actually lands rather than while the pointer merely
 * rests nearby. The preview only lifts an unselected row to pending, for the one a pending click
 * would add.
 */
export function rowSelectionMark(
  id: string,
  selectedIds: Set<string>,
  preview: Set<string> | null,
): RowSelectionMark {
  if (selectedIds.has(id)) return 'selected';
  if (preview !== null && preview.has(id)) return 'pending';
  return 'none';
}

/**
 * Applies one selection change.
 *
 * @param limit How many rows one bulk edit may cover
 */
export function bulkSelectionReducer(
  state: BulkSelectionState,
  action: BulkSelectionAction,
  limit: number = MAX_BULK_EDIT_TRANSACTIONS,
): BulkSelectionState {
  switch (action.type) {
    case 'toggle': {
      // Whether a row can be ticked is decided here rather than by each caller, so no route into
      // the state can put a row the app will not edit into the selection
      if (action.rows.find((row) => row.id === action.id)?.isReadOnly !== false) return state;

      // Ticking a row already selected always frees a slot, so only adding a new one is held at
      // the limit
      if (!state.selectedIds.has(action.id) && state.selectedIds.size >= limit) return state;

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
      const resulting = resultingSelection(state, action.id, action.rows, limit);
      if (resulting === null) {
        return bulkSelectionReducer(state, { type: 'toggle', id: action.id, rows: action.rows }, limit);
      }
      return { ...state, selectedIds: resulting, hoveredId: null, hoveredGroupIds: null };
    }

    case 'toggleGroup': {
      const resulting = groupResultingSelection(state.selectedIds, action.ids, action.rows, limit);
      if (resulting === null) return state;

      // No single row was clicked, so there is no anchor for a following shift-click to run from.
      // The baseline goes with it rather than being left behind pointing at ticks that have gone.
      // The heading preview is kept and refreshed to the ids just toggled rather than cleared, so
      // the rows the click just settled read against the tick's new state while the pointer keeps
      // resting there, rather than losing their mark until the next pointer move sets it again. A
      // touch tap or a keyboard activation has no such move to wait for, so either one clears the
      // preview outright instead
      return {
        selectedIds: resulting,
        anchorId: null,
        baselineIds: new Set(resulting),
        hoveredId: null,
        hoveredGroupIds: action.clearsHover ? null : action.ids,
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
