/**
 * The rules a selection follows once it can hold new items waiting for review beside ledger
 * transactions: what each bulk action says while it is off, what a bulk add sends and what the
 * toasts after a bulk add or dismissal say
 *
 * A new item has no merchant or category yet, so adding it in bulk needs both, and it keeps its own
 * bank amount. It isn't in the ledger, so it can be dismissed but not deleted or exported
 */
import type { BulkAddReviewValues } from '@/api/bank-sync'
import type { BulkEditFields } from '@/components/transactions/bulk-edit/selection'
import { countNoun } from '@/utils/bankSync'

/** What an empty selection says on a list that offers items waiting for review too */
export const NOTHING_TICKED_WITH_REVIEW = 'Tick a transaction or review item first'

/** Why Delete is off while an item waiting for review is ticked */
export const REVIEW_ITEMS_NOT_DELETED = 'Items waiting for review are dismissed, not deleted'

/** Why Dismiss is off while a ledger transaction is ticked */
export const ONLY_REVIEW_ITEMS_DISMISSED = 'Only items waiting for review can be dismissed'

/** Why Export selected is off while only items waiting for review are ticked */
export const REVIEW_ITEMS_NOT_EXPORTED = "Items waiting for review aren't in your ledger yet"

/** Why the bulk edit can't be applied while items waiting for review are ticked and a merchant or category isn't chosen */
export const REVIEW_ITEMS_NEED_MERCHANT_AND_CATEGORY = 'Choose a merchant and a category to add items to your ledger'

/**
 * Says why Dismiss is off, or nothing while it can run
 *
 * @param ledgerCount - How many ledger transactions are ticked
 * @param reviewCount - How many items waiting for review are ticked
 */
export function getDismissBlockReason(ledgerCount: number, reviewCount: number): string | undefined {
  if (ledgerCount > 0) return ONLY_REVIEW_ITEMS_DISMISSED
  if (reviewCount === 0) return NOTHING_TICKED_WITH_REVIEW
  return undefined
}

/**
 * The wording of the bulk edit's button: Apply for ledger transactions alone, and what is added and
 * updated once items waiting for review are ticked
 */
export function getBulkEditApplyLabel(ledgerCount: number, reviewCount: number): string {
  if (reviewCount === 0) return 'Apply'
  if (ledgerCount === 0) return `Add ${reviewCount} to ledger`
  return `Add ${reviewCount} and update ${ledgerCount}`
}

/**
 * The values a bulk add sends, read from the change the bulk edit holds
 *
 * Merchant and category are required by then, so the edit can't be applied without them. A note
 * taken off sends no note, since a new item has none to take off, and replacing tags sends the tags
 * chosen, since it has none to replace
 */
export function toBulkAddValues(fields: BulkEditFields): BulkAddReviewValues {
  return {
    merchant_id: fields.merchant_id ?? '',
    category_id: fields.category_id ?? '',
    ...(fields.add_tag_ids?.length ? { tag_ids: fields.add_tag_ids } : {}),
    ...(fields.notes ? { notes: fields.notes } : {}),
    ...(fields.dt ? { dt: fields.dt } : {}),
  }
}

/**
 * What skipped items add to a toast, or nothing when none was skipped. An item is skipped when it
 * changed since it was ticked, or when its bank amount has to be entered on its own
 */
function describeSkipped(skipped: number, verb: string): string {
  if (skipped === 0) return ''
  return ` ${countNoun(skipped, 'item')} couldn't be ${verb} and ${skipped === 1 ? 'still waits' : 'still wait'} for review.`
}

/**
 * What the toast says once a bulk add, and the update of any ledger transactions ticked beside it,
 * has gone through
 *
 * @param added - How many items were added to the ledger
 * @param skipped - How many items sent were skipped
 * @param updated - How many ledger transactions were updated, or null when none were ticked
 */
export function describeBulkAdd(added: number, skipped: number, updated: number | null): string {
  const addedText = `${countNoun(added, 'item')} added to your ledger`
  const updatedText = updated === null ? '' : ` and ${countNoun(updated, 'transaction')} updated`
  return `${addedText}${updatedText}.${describeSkipped(skipped, 'added')}`
}

/**
 * What the error toast says when the items were added but the update of the ledger transactions
 * ticked beside them was then refused
 *
 * @param added - How many items were added to the ledger
 * @param reason - What the server said about the update
 */
export function describeAddedButNotUpdated(added: number, reason: string): string {
  return `${countNoun(added, 'item')} added to your ledger, but the ticked transactions weren't updated. ${reason}`
}

/**
 * What the toast says once a bulk dismissal has gone through
 *
 * @param dismissed - How many items were dismissed
 * @param skipped - How many items sent were skipped
 */
export function describeBulkDismiss(dismissed: number, skipped: number): string {
  return `${countNoun(dismissed, 'item')} dismissed.${describeSkipped(skipped, 'dismissed')}`
}
