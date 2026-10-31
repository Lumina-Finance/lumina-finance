import { useState, type RefObject } from 'react'
import type { OptionItem } from '@/components/filters/OptionList'
import { FilterGlassPanel } from '@/components/list-controls/FilterGlassPanel'
import { FilterPanelBody } from '@/components/transactions/toolbar/FilterPanelBody'
import { useTransactionFilterDraft } from '@/components/transactions/toolbar/useTransactionFilterDraft'
import { getActiveFacetCount } from '@/components/transactions/utils/filterOptions'
import type { TransactionListFilters } from '@/components/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/components/transactions/toolbar/types'

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
  // The open width, for a place whose row the panel must cover edge to edge, instead of the usual width
  openWidth?: number

  // A container the open panel must stay inside, such as a dialog's scrolling body. The panel then fits
  // the height left there, with its options scrolling and its buttons on screen
  constrainTo?: RefObject<HTMLElement | null>
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
  openWidth = OPEN_WIDTH,
  constrainTo,
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
      openWidth={openWidth}
      constrainTo={constrainTo}
      open={open}
      onOpenChange={setOpen}
      activeFacetCount={open ? draft.activeFacetCount : getActiveFacetCount(filters, showAccountFilter, lockedCurrency)}
      seedDraftFromFilters={draft.seedDraftFromFilters}
      clearAll={draft.clearAll}
    >
      <FilterPanelBody draft={draft} showAccountFilter={showAccountFilter} fillHeight={!!constrainTo} />
    </FilterGlassPanel>
  )
}
