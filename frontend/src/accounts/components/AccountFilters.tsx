import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Plus, SlidersHorizontal, X } from 'lucide-react'
import type { AccountKind, AccountType } from '@/api/accounts'
import FilterChip from '@/components/FilterChip'
import FilterOptionList, { type OptionItem } from '@/components/FilterOptionList'
import type { AccountFilterValues } from '@/accounts/types/accounts'

export default function AccountFilters({
  filters,
  setFilter,
  institutionOptions,
  accountKindOptions,
  accountTypeOptions,
  onAddAccount,
}: {
  filters: AccountFilterValues
  setFilter: (patch: Partial<AccountFilterValues>) => void
  institutionOptions: OptionItem[]
  accountKindOptions: OptionItem[]
  accountTypeOptions: OptionItem[]
  onAddAccount: () => void
}) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  const [isMobileBackdropActive, setIsMobileBackdropActive] = useState(false)
  const mobileSheetPanelRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()

  const selectedInstitutionLabel = institutionOptions.find((option) => option.value === filters.institution_id)?.label ?? null
  const selectedKindLabel = accountKindOptions.find((option) => option.value === filters.account_kind)?.label ?? null
  const selectedTypeLabel = accountTypeOptions.find((option) => option.value === filters.account_type)?.label ?? null
  const activeFilterCount = [filters.institution_id, filters.account_kind, filters.account_type].filter(Boolean).length

  const openMobileSheet = useCallback(() => {
    setIsMobileBackdropActive(true)
    setIsMobileSheetOpen(true)
  }, [])

  const closeMobileSheet = useCallback(() => {
    setIsMobileSheetOpen(false)
  }, [])

  useEffect(() => {
    if (!isMobileSheetOpen) return

    const dismissOnOutsidePointer = (event: PointerEvent) => {
      const panel = mobileSheetPanelRef.current
      if (!panel || panel.contains(event.target as Node)) return
      closeMobileSheet()
    }

    document.addEventListener('pointerdown', dismissOnOutsidePointer)

    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer)
    }
  }, [closeMobileSheet, isMobileSheetOpen])

  useEffect(() => {
    if (!isMobileBackdropActive) return

    const root = document.documentElement
    const blurTarget = document.getElementById('app-page-content')
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = root.style.overflow
    const previousRootOverscroll = root.style.overscrollBehavior
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    const previousBlurTargetFilter = blurTarget?.style.filter ?? ''
    const previousBlurTargetOpacity = blurTarget?.style.opacity ?? ''
    const previousBlurTargetTransition = blurTarget?.style.transition ?? ''
    const previousBlurTargetWillChange = blurTarget?.style.willChange ?? ''
    const previousMobileNavigationToggleOpacity = mobileNavigationToggle?.style.opacity ?? ''
    const previousMobileNavigationTogglePointerEvents = mobileNavigationToggle?.style.pointerEvents ?? ''
    const previousMobileNavigationToggleTransition = mobileNavigationToggle?.style.transition ?? ''
    const previousMobileNavigationToggleWillChange = mobileNavigationToggle?.style.willChange ?? ''

    root.style.overflow = 'hidden'
    root.style.overscrollBehavior = 'none'
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    if (blurTarget) {
      blurTarget.style.transition = 'filter 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)'
      blurTarget.style.willChange = 'filter, opacity'
    }
    if (mobileNavigationToggle) {
      mobileNavigationToggle.style.transition = 'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)'
      mobileNavigationToggle.style.willChange = 'opacity'
    }

    return () => {
      root.style.overflow = previousRootOverflow
      root.style.overscrollBehavior = previousRootOverscroll
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousBodyOverscroll
      if (blurTarget) {
        blurTarget.style.filter = previousBlurTargetFilter
        blurTarget.style.opacity = previousBlurTargetOpacity
        blurTarget.style.transition = previousBlurTargetTransition
        blurTarget.style.willChange = previousBlurTargetWillChange
      }
      if (mobileNavigationToggle) {
        mobileNavigationToggle.style.opacity = previousMobileNavigationToggleOpacity
        mobileNavigationToggle.style.pointerEvents = previousMobileNavigationTogglePointerEvents
        mobileNavigationToggle.style.transition = previousMobileNavigationToggleTransition
        mobileNavigationToggle.style.willChange = previousMobileNavigationToggleWillChange
      }
    }
  }, [isMobileBackdropActive])

  useEffect(() => {
    if (!isMobileBackdropActive) return

    const blurTarget = document.getElementById('app-page-content')
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    if (!blurTarget && !mobileNavigationToggle) return

    const frame = window.requestAnimationFrame(() => {
      if (blurTarget) {
        blurTarget.style.filter = isMobileSheetOpen ? 'blur(7px)' : 'blur(0px)'
        blurTarget.style.opacity = isMobileSheetOpen ? '0.76' : '1'
      }
      if (mobileNavigationToggle) {
        mobileNavigationToggle.style.opacity = isMobileSheetOpen ? '0' : '1'
        mobileNavigationToggle.style.pointerEvents = isMobileSheetOpen ? 'none' : 'auto'
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isMobileBackdropActive, isMobileSheetOpen])

  const clearAllFilters = () => {
    setFilter({
      institution_id: undefined,
      account_kind: undefined,
      account_type: undefined,
    })
    closeMobileSheet()
  }

  const sheetInitial = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 30 }
  const sheetAnimate = shouldReduceMotion
    ? { opacity: 1 }
    : { opacity: 1, y: 0 }
  const sheetExit = shouldReduceMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 24 }

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
              options={accountKindOptions}
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
              options={accountTypeOptions}
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

      {createPortal(
        <AnimatePresence onExitComplete={() => {
          if (!isMobileSheetOpen) setIsMobileBackdropActive(false)
        }}>
          {isMobileSheetOpen && (
            <div
              className="fixed inset-x-0 -top-[env(safe-area-inset-top)] bottom-0 z-[100] min-[730px]:hidden"
              onClick={closeMobileSheet}
            >
              <motion.div
                className="absolute inset-0 h-full w-full cursor-default"
                style={{
                  background: 'color-mix(in srgb, var(--app-bg) 12%, transparent)',
                }}
                aria-hidden
                onPointerDown={closeMobileSheet}
                onClick={closeMobileSheet}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: shouldReduceMotion ? 0.01 : 0.22, ease: [0.22, 1, 0.36, 1] }}
              />
              <motion.div
                ref={mobileSheetPanelRef}
                role="dialog"
                aria-modal="true"
                aria-label="Account filters"
                className="absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col overflow-hidden rounded-t-2xl border-t"
                style={{
                  background: 'var(--app-bg)',
                  borderColor: 'var(--app-border)',
                  boxShadow: '0 -18px 44px color-mix(in srgb, var(--app-text) 16%, transparent)',
                }}
                initial={sheetInitial}
                animate={sheetAnimate}
                exit={sheetExit}
                transition={{ duration: shouldReduceMotion ? 0.01 : 0.3, ease: [0.22, 1, 0.36, 1] }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
                  <div>
                    <h2 className="text-base font-semibold">Filters</h2>
                    <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      {activeFilterCount === 0 ? 'No active filters' : `${activeFilterCount} active`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="app-secondary-button h-10 w-10 px-0"
                    onClick={closeMobileSheet}
                    aria-label="Close filters"
                  >
                    <X size={18} aria-hidden />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain py-5 pl-5 pr-6 [scrollbar-gutter:stable]">
                  <MobileFilterSection
                    title="Institution"
                    options={institutionOptions}
                    selectedValue={filters.institution_id}
                    selectedLabel={selectedInstitutionLabel}
                    searchPlaceholder="Search institutions..."
                    allLabel="All institutions"
                    onSelect={(value) => setFilter({ institution_id: value })}
                    onClear={() => setFilter({ institution_id: undefined })}
                    selectFirstSearchResultOnEnter
                  />
                  <MobileFilterSection
                    title="Category"
                    options={accountKindOptions}
                    selectedValue={filters.account_kind}
                    selectedLabel={selectedKindLabel}
                    searchPlaceholder="Search categories..."
                    allLabel="All categories"
                    onSelect={(value) => setFilter({ account_kind: value as AccountKind })}
                    onClear={() => setFilter({ account_kind: undefined })}
                    selectFirstSearchResultOnEnter
                  />
                  <MobileFilterSection
                    title="Type"
                    options={accountTypeOptions}
                    selectedValue={filters.account_type}
                    selectedLabel={selectedTypeLabel}
                    searchPlaceholder="Search types..."
                    allLabel="All types"
                    onSelect={(value) => setFilter({ account_type: value as AccountType })}
                    onClear={() => setFilter({ account_type: undefined })}
                    selectFirstSearchResultOnEnter
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 border-t px-5 py-4" style={{ borderColor: 'var(--app-border)' }}>
                  <button type="button" className="app-secondary-button" onClick={clearAllFilters}>
                    Clear
                  </button>
                  <button type="button" className="app-primary-button" onClick={closeMobileSheet}>
                    Done
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

function MobileFilterSection({
  title,
  options,
  selectedValue,
  selectedLabel,
  searchPlaceholder,
  allLabel,
  onSelect,
  onClear,
  selectFirstSearchResultOnEnter = false,
}: {
  title: string
  options: OptionItem[]
  selectedValue?: string
  selectedLabel: string | null
  searchPlaceholder: string
  allLabel: string
  onSelect: (value: string) => void
  onClear: () => void
  selectFirstSearchResultOnEnter?: boolean
}) {
  const [search, setSearch] = useState('')
  const hasSearch = search.trim().length > 0

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => option.label.toLowerCase().includes(query))
  }, [options, search])

  const groupedOptions = useMemo(() => {
    if (!filteredOptions.some((option) => option.group)) return null

    const groups: { label: string; items: OptionItem[] }[] = []
    let currentGroup: string | undefined

    for (const option of filteredOptions) {
      if (option.group !== currentGroup || groups.length === 0) {
        currentGroup = option.group
        groups.push({ label: option.group ?? '', items: [] })
      }
      groups[groups.length - 1].items.push(option)
    }

    return groups
  }, [filteredOptions])
  const highlightedValue = selectFirstSearchResultOnEnter && hasSearch ? filteredOptions[0]?.value : undefined

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || !highlightedValue) return
    event.preventDefault()
    onSelect(highlightedValue)
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-muted)' }}>
            {title}
          </h3>
          {selectedLabel && (
            <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--app-accent)' }}>
              {selectedLabel}
            </p>
          )}
        </div>
        {selectedValue && (
          <button
            type="button"
            className="text-sm font-medium"
            style={{ color: 'var(--app-accent)' }}
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>

      <input
        type="text"
        className="app-input mb-2"
        placeholder={searchPlaceholder}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={handleSearchKeyDown}
      />

      <div className="max-h-48 overflow-y-auto overscroll-contain rounded-xl border pr-2 [scrollbar-gutter:stable]" style={{ borderColor: 'var(--app-border)' }}>
        <MobileOptionRow label={allLabel} selected={!selectedValue} onClick={onClear} />
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            No matches
          </div>
        ) : groupedOptions ? (
          groupedOptions.map((group) => (
            <div key={group.label}>
              {group.label && (
                <div
                  className="sticky top-0 z-10 border-y px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
                  style={{
                    background: 'var(--app-bg)',
                    borderColor: 'var(--app-border)',
                    color: 'var(--app-text-subtle)',
                  }}
                >
                  {group.label}
                </div>
              )}
              {group.items.map((option) => (
                <MobileOptionRow
                  key={option.value}
                  label={option.label}
                  icon={option.icon}
                  selected={option.value === selectedValue}
                  highlighted={option.value === highlightedValue}
                  onClick={() => onSelect(option.value)}
                />
              ))}
            </div>
          ))
        ) : (
          filteredOptions.map((option) => (
            <MobileOptionRow
              key={option.value}
              label={option.label}
              icon={option.icon}
              selected={option.value === selectedValue}
              highlighted={option.value === highlightedValue}
              onClick={() => onSelect(option.value)}
            />
          ))
        )}
      </div>
    </section>
  )
}

function MobileOptionRow({
  label,
  icon,
  selected,
  highlighted = false,
  onClick,
}: {
  label: string
  icon?: string | null
  selected: boolean
  highlighted?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-[var(--app-surface-soft)] ${
        highlighted ? 'bg-[var(--app-surface-soft)]' : ''
      }`}
      style={{
        color: selected ? 'var(--app-accent)' : 'var(--app-text)',
        fontWeight: selected ? 600 : 400,
      }}
      onClick={onClick}
    >
      {icon && <span className="shrink-0 text-base leading-none" aria-hidden>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check size={16} className="shrink-0" aria-hidden />}
    </button>
  )
}
