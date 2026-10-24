import { isSameSelection } from '@/components/list-controls/sameSelection'
import type { TransactionListFilters } from '@/components/transactions/types/transactionList'

/**
 * Returns whether applying the patch would leave the applied transaction filters as they are
 *
 * Lists match whatever their order and a missing list matches an empty one. The tag match mode only
 * counts while tags are chosen, since it is dropped from the patch otherwise
 */
export function isFilterPatchApplied(patch: TransactionListFilters, applied: TransactionListFilters): boolean {
  const sameLists = (['account_id', 'category_id', 'merchant_id', 'tag_id'] as const)
    .every((key) => isSameSelection(patch[key], applied[key]))
  const sameValues = (['currency', 'min_amount', 'max_amount', 'amount_currency', 'from_date', 'to_date'] as const)
    .every((key) => patch[key] === applied[key])
  const sameTagMatch = !patch.tag_id?.length || patch.tag_match === (applied.tag_match ?? 'all')

  return sameLists && sameValues && sameTagMatch
}
