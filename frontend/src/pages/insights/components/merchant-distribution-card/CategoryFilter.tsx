import { useCallback, useRef, useState, type RefObject } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { MultiSelectChecklist } from '@/components/filters/MultiSelectChecklist'
import { FilterGlassPanel } from '@/components/list-controls/FilterGlassPanel'
import { APPLY_FILTERS_DISABLED_REASON } from '@/components/list-controls/filterReasons'
import { MobileFilterSheet } from '@/components/list-controls/MobileFilterSheet'
import { isSameSelection } from '@/components/list-controls/sameSelection'
import { useSeedDraftOnOpen } from '@/components/list-controls/useSeedDraftOnOpen'
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
const CLEAR_DISABLED_REASON = 'No filter is set'

type MerchantCategoryFilterProps = {
  categoryOptions: OptionItem[]
  selectedIds: string[]
  onChange: (categoryIds: string[]) => void
}

/**
 * Renders the merchant distribution's category filter: one searchable multi-select of expense
 * categories, applied or cleared as a whole. A wide screen gets the shared collapsing filter pill
 * and a phone gets the shared full-screen sheet, as the account and transaction lists do
 */
export function MerchantCategoryFilter({ categoryOptions, selectedIds, onChange }: MerchantCategoryFilterProps) {
  const [open, setOpen] = useState(false)
  const [sheetMounted, setSheetMounted] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds)
  // The "none applied" line above each Clear all. That button's reason hangs clear of it. The
  // panel and the sheet each draw one
  const panelNoneRef = useRef<HTMLDivElement>(null)
  const sheetNoneRef = useRef<HTMLDivElement>(null)

  const seedDraftFromFilters = useCallback(() => setDraftIds(selectedIds), [selectedIds])
  useSeedDraftOnOpen(sheetOpen, seedDraftFromFilters)

  function toggleCategory(categoryId: string) {
    setDraftIds((current) =>
      current.includes(categoryId) ? current.filter((id) => id !== categoryId) : [...current, categoryId],
    )
  }

  function clearAll() {
    setDraftIds([])
    onChange([])
    setOpen(false)
    setSheetOpen(false)
  }

  function applyFilters() {
    onChange(draftIds)
    setOpen(false)
    setSheetOpen(false)
  }

  const chips = draftIds.map((categoryId) => ({
    key: categoryId,
    label: categoryOptions.find((option) => option.value === categoryId)?.label ?? categoryId,
    onRemove: () => toggleCategory(categoryId),
  }))

  const body = (fillHeight: boolean, noneRef: RefObject<HTMLDivElement | null>) => (
    <>
      {categoryOptions.length === 0 ? (
        <p className="py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          No expense categories available
        </p>
      ) : (
        <MultiSelectChecklist
          options={categoryOptions}
          selectedValues={draftIds}
          searchPlaceholder="Search categories"
          fillHeight={fillHeight}
          onToggle={toggleCategory}
        />
      )}
      <ActiveFilterChips chips={chips} emptyLabel={NONE_APPLIED_LABEL} rowRef={noneRef} />
    </>
  )

  return (
    <>
      <div className="hidden min-[750px]:block">
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
          {body(false, panelNoneRef)}
          <div className="mt-3 flex items-center justify-between">
            <DisabledReasonButton
              className="app-secondary-button"
              disabledReason={draftIds.length === 0 && selectedIds.length === 0 ? CLEAR_DISABLED_REASON : undefined}
              keepReasonClearOf={panelNoneRef}
              onClick={clearAll}
            >
              Clear all
            </DisabledReasonButton>
            <button type="button" className="app-glass-button-primary" onClick={applyFilters}>
              {APPLY_LABEL}
            </button>
          </div>
        </FilterGlassPanel>
      </div>

      {/* The dashboard's phone range selector is this same full-width glass pill, so the two controls
          read as one family and share their edges on a row of their own */}
      <div className="app-range-glass app-range-glass-full min-[750px]:hidden">
        <button
          type="button"
          className="app-range-glass-head"
          aria-label={FILTER_ARIA_LABEL}
          onClick={() => {
            setSheetMounted(true)
            setSheetOpen(true)
          }}
        >
          <span className="app-range-glass-cur">
            <SlidersHorizontal size={18} aria-hidden className="shrink-0" />
            <span>{FILTER_LABEL}</span>
          </span>
          {selectedIds.length > 0 && (
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold"
              style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
            >
              {selectedIds.length}
            </span>
          )}
        </button>
      </div>

      {sheetMounted && (
        <MobileFilterSheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onExitComplete={() => setSheetMounted(false)}
          ariaLabel={FILTER_ARIA_LABEL}
          title={FILTER_LABEL}
          applyLabel={APPLY_LABEL}
          activeFacetCount={draftIds.length}
          clearAll={clearAll}
          applyFilters={applyFilters}
          applyDisabledReason={isSameSelection(draftIds, selectedIds) ? APPLY_FILTERS_DISABLED_REASON : undefined}
          clearDisabledReason={CLEAR_DISABLED_REASON}
          clearReasonKeepClearOf={sheetNoneRef}
          equalFooterButtons
        >
          {() => body(true, sheetNoneRef)}
        </MobileFilterSheet>
      )}
    </>
  )
}
