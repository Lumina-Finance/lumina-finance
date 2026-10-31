import type { OptionItem } from '@/components/filters/OptionList'
import { APPLY_FILTERS_DISABLED_REASON } from '@/components/list-controls/filterReasons'
import { MobileFilterSheet } from '@/components/list-controls/MobileFilterSheet'
import { useSeedDraftOnOpen } from '@/components/list-controls/useSeedDraftOnOpen'
import { FilterPanelBody } from '@/components/transactions/toolbar/FilterPanelBody'
import { useTransactionFilterDraft } from '@/components/transactions/toolbar/useTransactionFilterDraft'
import type { TransactionListFilters } from '@/components/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/components/transactions/toolbar/types'

type MobileFilterPanelProps = {
  isOpen: boolean
  onClose: () => void
  // Fires once the close animation finishes so the parent can unmount and release the scroll lock
  onExitComplete: () => void
  accountOptions: OptionItem[]
  categoryOptions: OptionItem[]
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
  // False on an account's own transaction list, where the account facet is disabled
  showAccountFilter: boolean
  // The account's currency on its own transaction list, which pins the amount currency
  lockedCurrency?: string

  // True when it opens from inside a dialog, so the sheet draws above that dialog
  aboveDialog?: boolean
}

/**
 * Renders the mobile transaction filter: the transaction filter draft plumbed into the shared
 * full-screen sheet, reusing the same draft and body as the desktop pill
 */
export function MobileFilterPanel({
  isOpen,
  onClose,
  onExitComplete,
  accountOptions,
  categoryOptions,
  filters,
  setFilter,
  showAccountFilter,
  lockedCurrency,
  aboveDialog,
}: MobileFilterPanelProps) {
  const draft = useTransactionFilterDraft({
    filters,
    setFilter,
    accountOptions,
    categoryOptions,
    showAccountFilter,
    lockedCurrency,
    onClose,
  })

  useSeedDraftOnOpen(isOpen, draft.seedDraftFromFilters)

  return (
    <MobileFilterSheet
      isOpen={isOpen}
      onClose={onClose}
      onExitComplete={onExitComplete}
      ariaLabel="Transaction filters"
      aboveDialog={aboveDialog}
      activeFacetCount={draft.activeFacetCount}
      clearAll={draft.clearAll}
      applyFilters={draft.applyFilters}
      applyDisabledReason={
        draft.applyBlockedReason ?? (draft.isDraftApplied ? APPLY_FILTERS_DISABLED_REASON : undefined)
      }
    >
      {(headingId) => (
        <FilterPanelBody
          draft={draft}
          showFooter={false}
          mobile
          fillHeight
          showAccountFilter={showAccountFilter}
          facetLabelledBy={headingId}
        />
      )}
    </MobileFilterSheet>
  )
}
