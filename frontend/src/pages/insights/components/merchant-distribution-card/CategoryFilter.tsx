import { useCallback, useState } from 'react'
import type { OptionItem } from '@/components/filters/OptionList'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
import { FilterGlassPanel } from '@/components/list-controls/FilterGlassPanel'
import { CLEAR_FILTERS_DISABLED_REASON } from '@/components/list-controls/filterReasons'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

// Open width of the glass, enough for the longest category names beside their icons. The glass is
// anchored to its collapsed right edge, so opening grows this width leftward over the card
const OPEN_WIDTH = 340

// The card holds one filter, so its control, panel and sheet all say "filter" rather than the plural
// the list toolbars use
const FILTER_LABEL = 'Filter'
const APPLY_LABEL = 'Apply filter'
const CLEAR_LABEL = 'Clear filter'
const FILTER_ARIA_LABEL = 'Merchant category filter'
const NONE_APPLIED_LABEL = 'No filter applied'

type MerchantCategoryFilterProps = {
  categoryOptions: OptionItem[]
  selectedIds: string[]
  onChange: (categoryIds: string[]) => void
}

/**
 * Renders the merchant distribution's category filter: the shared collapsing filter pill holding one
 * searchable multi-select of expense categories, applied or cleared as a whole
 */
export function MerchantCategoryFilter({ categoryOptions, selectedIds, onChange }: MerchantCategoryFilterProps) {
  const [open, setOpen] = useState(false)
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds)

  const seedDraftFromFilters = useCallback(() => setDraftIds(selectedIds), [selectedIds])

  function toggleCategory(categoryId: string) {
    setDraftIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    )
  }

  function clearAll() {
    setDraftIds([])
    onChange([])
    setOpen(false)
  }

  function applyFilters() {
    onChange(draftIds)
    setOpen(false)
  }

  const chips = draftIds.map((categoryId) => ({
    key: categoryId,
    label: categoryOptions.find((option) => option.value === categoryId)?.label ?? categoryId,
    onRemove: () => toggleCategory(categoryId),
  }))

  return (
    <FilterGlassPanel
      ariaLabel={FILTER_ARIA_LABEL}
      label={FILTER_LABEL}
      clearLabel={CLEAR_LABEL}
      openWidth={OPEN_WIDTH}
      open={open}
      onOpenChange={setOpen}
      activeFacetCount={open ? draftIds.length : selectedIds.length}
      seedDraftFromFilters={seedDraftFromFilters}
      clearAll={clearAll}
    >
      {categoryOptions.length === 0 ? (
        <p className="py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          No expense categories available
        </p>
      ) : (
        <MultiSelectChecklist
          options={categoryOptions}
          selectedValues={draftIds}
          searchPlaceholder="Search categories"
          fillHeight={false}
          onToggle={toggleCategory}
        />
      )}
      <ActiveFilterChips chips={chips} emptyLabel={NONE_APPLIED_LABEL} />
      <div className="mt-3 flex items-center justify-between">
        <DisabledReasonButton
          className="app-secondary-button"
          disabledReason={draftIds.length === 0 && selectedIds.length === 0 ? CLEAR_FILTERS_DISABLED_REASON : undefined}
          onClick={clearAll}
        >
          Clear all
        </DisabledReasonButton>
        <button type="button" className="app-glass-button-primary" onClick={applyFilters}>
          {APPLY_LABEL}
        </button>
      </div>
    </FilterGlassPanel>
  )
}
