import type { OptionItem } from '@/components/filters/OptionList'
import { MobileFilterGlassPanel } from '@/components/list-controls/MobileFilterGlassPanel'
import { useSeedDraftOnOpen } from '@/components/list-controls/useSeedDraftOnOpen'
import { FilterPanelBody } from '@/pages/transactions/components/toolbar/FilterPanelBody'
import { useTransactionFilterDraft } from '@/pages/transactions/components/toolbar/useTransactionFilterDraft'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/pages/transactions/components/toolbar/types'

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
}

/**
 * Renders the mobile transaction filter: the transaction filter draft plumbed into the shared
 * full-screen glass modal, reusing the same draft and body as the desktop pill
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
}: MobileFilterPanelProps) {
  const draft = useTransactionFilterDraft({ filters, setFilter, accountOptions, categoryOptions, showAccountFilter, lockedCurrency, onClose })

  useSeedDraftOnOpen(isOpen, draft.seedDraftFromFilters)

  return (
    <MobileFilterGlassPanel
      isOpen={isOpen}
      onClose={onClose}
      onExitComplete={onExitComplete}
      ariaLabel="Transaction filters"
      activeFacetCount={draft.activeFacetCount}
      clearAll={draft.clearAll}
      applyFilters={draft.applyFilters}
      isApplyDisabled={draft.hasCrossedAmountBounds}
    >
      <FilterPanelBody draft={draft} showFooter={false} mobile fillHeight showAccountFilter={showAccountFilter} />
    </MobileFilterGlassPanel>
  )
}
