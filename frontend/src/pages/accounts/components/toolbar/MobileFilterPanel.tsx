import type { OptionItem } from '@/components/filters/OptionList'
import { MobileFilterSheet } from '@/components/list-controls/MobileFilterSheet'
import { useSeedDraftOnOpen } from '@/components/list-controls/useSeedDraftOnOpen'
import { FilterPanelBody } from '@/pages/accounts/components/toolbar/FilterPanelBody'
import { useAccountFilterDraft } from '@/pages/accounts/components/toolbar/useAccountFilterDraft'
import type { AccountFilterSetter } from '@/pages/accounts/components/toolbar/types'
import type { FilterValues } from '@/pages/accounts/types/accounts'

type MobileFilterPanelProps = {
  isOpen: boolean
  onClose: () => void
  // Fires once the close animation finishes so the parent can unmount and release the scroll lock
  onExitComplete: () => void
  institutionOptions: OptionItem[]
  kindOptions: OptionItem[]
  typeOptions: OptionItem[]
  filters: FilterValues
  setFilter: AccountFilterSetter
}

/**
 * Renders the mobile account filter: the account filter draft plumbed into the shared full-screen
 * sheet, reusing the same draft and body as the desktop pill
 */
export function MobileFilterPanel({
  isOpen,
  onClose,
  onExitComplete,
  institutionOptions,
  kindOptions,
  typeOptions,
  filters,
  setFilter,
}: MobileFilterPanelProps) {
  const draft = useAccountFilterDraft({ filters, setFilter, institutionOptions, kindOptions, typeOptions, onClose })

  useSeedDraftOnOpen(isOpen, draft.seedDraftFromFilters)

  return (
    <MobileFilterSheet
      isOpen={isOpen}
      onClose={onClose}
      onExitComplete={onExitComplete}
      ariaLabel="Account filters"
      activeFacetCount={draft.activeFacetCount}
      clearAll={draft.clearAll}
      applyFilters={draft.applyFilters}
    >
      <FilterPanelBody draft={draft} showFooter={false} mobile fillHeight />
    </MobileFilterSheet>
  )
}
