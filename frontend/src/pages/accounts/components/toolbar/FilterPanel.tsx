import { useState } from 'react'
import type { OptionItem } from '@/components/filters/OptionList'
import { FilterGlassPanel } from '@/components/list-controls/FilterGlassPanel'
import { FilterPanelBody } from '@/pages/accounts/components/toolbar/FilterPanelBody'
import { useAccountFilterDraft } from '@/pages/accounts/components/toolbar/useAccountFilterDraft'
import type { FilterValues } from '@/pages/accounts/types/accounts'

// Open width of the glass, wide enough to seat the three facet tabs and the longest institution
// names without crowding. The glass is anchored to its collapsed right edge, so opening grows this
// width leftward over the toolbar
const OPEN_WIDTH = 380

type AccountFilterPanelProps = {
  institutionOptions: OptionItem[]
  kindOptions: OptionItem[]
  typeOptions: OptionItem[]
  filters: FilterValues
  setFilter: (patch: Partial<FilterValues>) => void
}

/**
 * Renders the desktop account filter control: the account filter draft plumbed into the shared
 * collapsing glass panel
 */
export function AccountFilterPanel({
  institutionOptions,
  kindOptions,
  typeOptions,
  filters,
  setFilter,
}: AccountFilterPanelProps) {
  const [open, setOpen] = useState(false)

  const draft = useAccountFilterDraft({
    filters,
    setFilter,
    institutionOptions,
    kindOptions,
    typeOptions,
    onClose: () => setOpen(false),
  })

  return (
    <FilterGlassPanel
      ariaLabel="Account filters"
      openWidth={OPEN_WIDTH}
      open={open}
      onOpenChange={setOpen}
      activeFacetCount={draft.activeFacetCount}
      seedDraftFromFilters={draft.seedDraftFromFilters}
      clearAll={draft.clearAll}
    >
      <FilterPanelBody draft={draft} fillHeight />
    </FilterGlassPanel>
  )
}
