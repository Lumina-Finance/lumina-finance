import { useMemo } from 'react'
import { Store } from 'lucide-react'
import {
  useInfiniteMerchants,
  type Merchant,
} from '@/api/merchants'
import MergeDeleteReferenceModal from '@/pages/settings/components/shared/modals/MergeDeleteReferenceModal'
import {
  DELETE_SPINNER_MS,
  MERCHANT_MERGE_PAGE_SIZE,
} from '@/pages/settings/components/merchant-settings-section/constants'
import { merchantMergeOptions } from '@/pages/settings/components/merchant-settings-section/utils'

/**
 * Resolves the merchants offered as a replacement, querying the same group as the merchant
 * being replaced and paging in more matches as the user scrolls or searches
 */
function useMerchantReplacementQuery(merchant: Merchant, search: string) {
  const query = useInfiniteMerchants(
    { group_id: merchant.group_id ?? undefined, q: search.trim() || undefined },
    MERCHANT_MERGE_PAGE_SIZE,
  )
  const replacements = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    replacements,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage()
    },
  }
}

/**
 * Modal shown when a merchant cannot be deleted because transactions still reference it,
 * asking which merchant those transactions should move to before the original is removed
 *
 * The replacement options only offer merchants sharing the same group as the one being deleted
 */
export default function MergeDeleteMerchantModal({
  merchant,
  isPending,
  onClose,
  onMerge,
}: {
  merchant: Merchant
  isPending: boolean
  onClose: () => void
  onMerge: (replacementMerchantId: string) => Promise<void>
}) {
  return (
    <MergeDeleteReferenceModal
      item={merchant}
      isPending={isPending}
      submitMinVisibleMs={DELETE_SPINNER_MS}
      filterOptionsLocally={false}
      icon={Store}
      buildOptions={merchantMergeOptions}
      useReplacementQuery={useMerchantReplacementQuery}
      wording={{
        entityLabel: 'Merchant',
        fieldLabel: 'Replacement Merchant',
        description: `${merchant.name} is used by existing transactions. Choose another merchant for those transactions, then it can be deleted.`,
        selectSrLabel: 'Replacement merchant',
        searchPlaceholder: 'Search merchants...',
        selectPlaceholder: 'Select merchant...',
        emptyOptionsPlaceholder: 'No compatible merchants',
        loadingPlaceholder: 'Loading merchants...',
        requireSelectionError: 'Select a replacement merchant.',
        deleteErrorFallback: 'Failed to delete merchant.',
      }}
      onClose={onClose}
      onMerge={onMerge}
    />
  )
}
