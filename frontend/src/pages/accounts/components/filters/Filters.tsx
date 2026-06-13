import { useCallback, useState } from 'react'
import { Plus, SlidersHorizontal } from 'lucide-react'
import type { AccountKind, AccountType } from '@/api/accounts'
import FilterChip from '@/components/filters/Chip'
import FilterOptionList, { type OptionItem } from '@/components/filters/OptionList'
import type { FilterValues } from '@/pages/accounts/types/accounts'
import { MobileFilterSheet } from './MobileSheet'

type FiltersProps = {
  filters: FilterValues
  setFilter: (patch: Partial<FilterValues>) => void
  institutionOptions: OptionItem[]
  kindOptions: OptionItem[]
  typeOptions: OptionItem[]
  onAddAccount: () => void
}

/**
 * Renders filter controls and delegates mobile sheet behaviour to the sheet component
 */
export default function Filters({
  filters,
  setFilter,
  institutionOptions,
  kindOptions,
  typeOptions,
  onAddAccount,
}: FiltersProps) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  const [isMobileBackdropActive, setIsMobileBackdropActive] = useState(false)

  const selectedInstitutionLabel = institutionOptions.find((option) => option.value === filters.institution_id)?.label ?? null
  const selectedKindLabel = kindOptions.find((option) => option.value === filters.account_kind)?.label ?? null
  const selectedTypeLabel = typeOptions.find((option) => option.value === filters.account_type)?.label ?? null
  const activeFilterCount = [filters.institution_id, filters.account_kind, filters.account_type].filter(Boolean).length

  const openMobileSheet = useCallback(() => {
    setIsMobileBackdropActive(true)
    setIsMobileSheetOpen(true)
  }, [])

  const closeMobileSheet = useCallback(() => {
    setIsMobileSheetOpen(false)
  }, [])

  return (
    <>
      <div className="flex w-full items-center gap-3 min-[730px]:hidden">
        <button
          type="button"
          className="app-secondary-button min-w-0 flex-1 justify-between"
          onClick={openMobileSheet}
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal size={17} aria-hidden />
            <span>Filters</span>
          </span>
          {activeFilterCount > 0 && (
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold"
              style={{
                background: 'var(--app-accent-soft)',
                color: 'var(--app-accent)',
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className="app-primary-button h-10 w-10 shrink-0 px-0"
          onClick={onAddAccount}
          aria-label="Add account"
        >
          <Plus size={18} aria-hidden />
        </button>
      </div>

      <div className="hidden flex-wrap items-center gap-4 min-[730px]:flex">
        <FilterChip
          label="Institution"
          selectedLabel={selectedInstitutionLabel}
          onClear={() => setFilter({ institution_id: undefined })}
        >
          {(close) => (
            <FilterOptionList
              options={institutionOptions}
              selectedValue={filters.institution_id}
              onSelect={(value) => { setFilter({ institution_id: value }); close() }}
              searchPlaceholder="Search institutions..."
              selectFirstSearchResultOnEnter
            />
          )}
        </FilterChip>

        <FilterChip
          label="Category"
          selectedLabel={selectedKindLabel}
          onClear={() => setFilter({ account_kind: undefined })}
        >
          {(close) => (
            <FilterOptionList
              options={kindOptions}
              selectedValue={filters.account_kind}
              onSelect={(value) => { setFilter({ account_kind: value as AccountKind }); close() }}
              searchPlaceholder="Search categories..."
              selectFirstSearchResultOnEnter
            />
          )}
        </FilterChip>

        <FilterChip
          label="Type"
          selectedLabel={selectedTypeLabel}
          onClear={() => setFilter({ account_type: undefined })}
        >
          {(close) => (
            <FilterOptionList
              options={typeOptions}
              selectedValue={filters.account_type}
              onSelect={(value) => { setFilter({ account_type: value as AccountType }); close() }}
              searchPlaceholder="Search types..."
              selectFirstSearchResultOnEnter
            />
          )}
        </FilterChip>

        <button
          type="button"
          className="app-primary-button ml-auto h-10 shrink-0"
          onClick={onAddAccount}
        >
          <Plus size={18} aria-hidden />
          <span>Add Account</span>
        </button>
      </div>

      {isMobileBackdropActive && (
        <MobileFilterSheet
          isOpen={isMobileSheetOpen}
          activeFilterCount={activeFilterCount}
          filters={filters}
          setFilter={setFilter}
          institutionOptions={institutionOptions}
          kindOptions={kindOptions}
          typeOptions={typeOptions}
          selectedInstitutionLabel={selectedInstitutionLabel}
          selectedKindLabel={selectedKindLabel}
          selectedTypeLabel={selectedTypeLabel}
          onClose={closeMobileSheet}
          onExitComplete={() => {
            if (!isMobileSheetOpen) setIsMobileBackdropActive(false)
          }}
        />
      )}
    </>
  )
}
