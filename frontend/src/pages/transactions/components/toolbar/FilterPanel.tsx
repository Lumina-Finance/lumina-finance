import { useState } from 'react'
import type { OptionItem } from '@/components/filters/OptionList'
import { FilterGlassPanel } from '@/components/list-controls/FilterGlassPanel'
import { FilterPanelBody } from '@/pages/transactions/components/toolbar/FilterPanelBody'
import { useTransactionFilterDraft } from '@/pages/transactions/components/toolbar/useTransactionFilterDraft'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/pages/transactions/components/toolbar/types'

// Open width of the glass, wide enough to seat the facet tabs without crowding. The glass is
// anchored to its collapsed right edge, so opening grows this width leftward over the toolbar
const OPEN_WIDTH = 468

type TransactionFilterPanelProps = {
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
 * Renders the desktop transaction filter control: the transaction filter draft plumbed into the
 * shared collapsing glass panel
 */
export function TransactionFilterPanel({
  accountOptions,
  categoryOptions,
  filters,
  setFilter,
  showAccountFilter,
  lockedCurrency,
}: TransactionFilterPanelProps) {
  const [open, setOpen] = useState(false)

  const draft = useTransactionFilterDraft({
    filters,
    setFilter,
    accountOptions,
    categoryOptions,
    showAccountFilter,
    lockedCurrency,
    onClose: () => setOpen(false),
  })

  return (
    <FilterGlassPanel
      ariaLabel="Transaction filters"
      openWidth={OPEN_WIDTH}
      open={open}
      onOpenChange={setOpen}
      activeFacetCount={draft.activeFacetCount}
      seedDraftFromFilters={draft.seedDraftFromFilters}
      clearAll={draft.clearAll}
    >
      <FilterPanelBody draft={draft} fillHeight showAccountFilter={showAccountFilter} />
    </FilterGlassPanel>
  )
}
