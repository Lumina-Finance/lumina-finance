import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { Category } from '@/api/categories'
import DateRangeFilterPanel from '@/components/DateRangeFilterPanel'
import FilterChip from '@/components/FilterChip'
import FilterOptionList, { type OptionItem } from '@/components/FilterOptionList'
import { DEFAULT_TRANSACTION_CATEGORY_ICON } from '@/transactions/constants/transactionList'
import type { TransactionListAccount, TransactionListFilters } from '@/transactions/types/transactionList'
import { formatDateRangeLabel } from '@/transactions/utils/date'

const CATEGORY_KIND_LABELS: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}
const DESKTOP_SEARCH_MIN_WIDTH = 320
const DATE_HEADER_STICKY_GAP_PX = 4

export default function TransactionListToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  filters,
  setFilter,
  categories,
  accounts,
  showAccountFilter,
  pendingFrom,
  pendingTo,
  dateRangeChanged,
  dateRangeInvalid,
  onPendingFromChange,
  onPendingToChange,
  onDateRangeReset,
  onDateRangeClose,
  onCreateTransaction,
  onStickyOffsetChange,
}: {
  search: string
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  filters: TransactionListFilters
  setFilter: (patch: Partial<TransactionListFilters>) => void
  categories?: Category[]
  accounts?: TransactionListAccount[]
  showAccountFilter: boolean
  pendingFrom: string
  pendingTo: string
  dateRangeChanged: boolean
  dateRangeInvalid: boolean
  onPendingFromChange: (value: string) => void
  onPendingToChange: (value: string) => void
  onDateRangeReset: () => void
  onDateRangeClose: () => void
  onCreateTransaction: () => void
  onStickyOffsetChange?: (offset: number) => void
}) {
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false)
  const [isMobileBackdropActive, setIsMobileBackdropActive] = useState(false)
  const [desktopInlineLayout, setDesktopInlineLayout] = useState(false)
  const [desktopCreateStacked, setDesktopCreateStacked] = useState(false)
  const [mobileSearchStuck, setMobileSearchStuck] = useState(false)
  const mobileSheetPanelRef = useRef<HTMLDivElement>(null)
  const mobileSearchStickySentinelRef = useRef<HTMLDivElement>(null)
  const desktopToolbarRef = useRef<HTMLDivElement>(null)
  const desktopControlsRef = useRef<HTMLDivElement>(null)
  const desktopFilterGroupRef = useRef<HTMLDivElement>(null)
  const desktopCreateMeasureRef = useRef<HTMLButtonElement>(null)
  const shouldReduceMotion = useReducedMotion()

  const accountOptions = useMemo(
    () => (accounts ?? []).map((account) => ({
      value: account.id,
      label: account.name ?? 'Unnamed account',
    })),
    [accounts],
  )
  const categoryOptions = useMemo(
    () => (['expense', 'income', 'transfer'] as const).flatMap((kind) =>
      (categories ?? [])
        .filter((category) => category.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((category) => ({
          value: category.id,
          label: category.name,
          group: CATEGORY_KIND_LABELS[kind],
          icon: category.icon ?? DEFAULT_TRANSACTION_CATEGORY_ICON,
        })),
    ),
    [categories],
  )
  const selectedAccountLabel = accounts?.find((account) => account.id === filters.account_id)?.name ?? null
  const selectedCategoryLabel = categories?.find((category) => category.id === filters.category_id)?.name ?? null
  const selectedDateLabel = formatDateRangeLabel(filters.from_date, filters.to_date)
  const activeFilterCount = [
    showAccountFilter && filters.account_id,
    filters.category_id,
    filters.from_date || filters.to_date,
  ].filter(Boolean).length

  useLayoutEffect(() => {
    const toolbar = desktopToolbarRef.current
    const controls = desktopControlsRef.current
    const filterGroup = desktopFilterGroupRef.current
    const createMeasure = desktopCreateMeasureRef.current
    if (!toolbar || !controls || !filterGroup || !createMeasure) return

    const updateCreateLayout = () => {
      if (!window.matchMedia('(min-width: 750px)').matches) {
        setDesktopInlineLayout(false)
        setDesktopCreateStacked(false)
        return
      }

      const toolbarWidth = toolbar.getBoundingClientRect().width
      if (toolbarWidth <= 0) return

      const filterItems = Array.from(filterGroup.children)
      const filterGap = parseFloat(getComputedStyle(filterGroup).columnGap) || 0
      const filterWidth = filterItems.reduce((total, item, index) => (
        total + (item as HTMLElement).getBoundingClientRect().width + (index === 0 ? 0 : filterGap)
      ), 0)
      const controlsGap = parseFloat(getComputedStyle(controls).columnGap) || 0
      const createWidth = createMeasure.getBoundingClientRect().width
      const inlineFits = DESKTOP_SEARCH_MIN_WIDTH + controlsGap + filterWidth + controlsGap + createWidth <= toolbarWidth
      const shouldStack = !inlineFits && filterWidth + controlsGap + createWidth > toolbarWidth

      setDesktopInlineLayout((current) => (current === inlineFits ? current : inlineFits))
      setDesktopCreateStacked((current) => (current === shouldStack ? current : shouldStack))
    }

    updateCreateLayout()

    const resizeObserver = new ResizeObserver(updateCreateLayout)
    resizeObserver.observe(toolbar)
    resizeObserver.observe(controls)
    resizeObserver.observe(filterGroup)
    resizeObserver.observe(createMeasure)
    window.addEventListener('resize', updateCreateLayout)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateCreateLayout)
    }
  }, [selectedAccountLabel, selectedCategoryLabel, selectedDateLabel, showAccountFilter])

  useLayoutEffect(() => {
    const toolbar = desktopToolbarRef.current
    if (!toolbar || !onStickyOffsetChange) return

    const updateStickyOffset = () => {
      onStickyOffsetChange(Math.ceil(toolbar.getBoundingClientRect().height + DATE_HEADER_STICKY_GAP_PX))
    }

    updateStickyOffset()

    const resizeObserver = new ResizeObserver(updateStickyOffset)
    resizeObserver.observe(toolbar)
    window.addEventListener('resize', updateStickyOffset)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateStickyOffset)
    }
  }, [onStickyOffsetChange])

  useEffect(() => {
    const sentinel = mobileSearchStickySentinelRef.current
    if (!sentinel) return

    const mobileQuery = window.matchMedia('(max-width: 1049px)')
    let sentinelIntersecting = true

    const updateStuck = () => {
      setMobileSearchStuck(mobileQuery.matches && !sentinelIntersecting)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        sentinelIntersecting = entry.isIntersecting
        updateStuck()
      },
      { threshold: 0 },
    )

    observer.observe(sentinel)
    mobileQuery.addEventListener('change', updateStuck)

    return () => {
      observer.disconnect()
      mobileQuery.removeEventListener('change', updateStuck)
    }
  }, [])

  const openMobileSheet = useCallback(() => {
    setIsMobileBackdropActive(true)
    setIsMobileSheetOpen(true)
  }, [])

  const closeMobileSheet = useCallback(() => {
    onDateRangeClose()
    setIsMobileSheetOpen(false)
  }, [onDateRangeClose])

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

    const blurTarget = document.getElementById('app-page-content')
    const mobileNavigationToggle = document.getElementById('app-mobile-navigation-toggle')
    const previousBlurTargetFilter = blurTarget?.style.filter ?? ''
    const previousBlurTargetOpacity = blurTarget?.style.opacity ?? ''
    const previousBlurTargetTransition = blurTarget?.style.transition ?? ''
    const previousBlurTargetWillChange = blurTarget?.style.willChange ?? ''
    const previousMobileNavigationToggleOpacity = mobileNavigationToggle?.style.opacity ?? ''
    const previousMobileNavigationTogglePointerEvents = mobileNavigationToggle?.style.pointerEvents ?? ''
    const previousMobileNavigationToggleTransition = mobileNavigationToggle?.style.transition ?? ''
    const previousMobileNavigationToggleWillChange = mobileNavigationToggle?.style.willChange ?? ''

    if (blurTarget) {
      blurTarget.style.transition = 'filter 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms cubic-bezier(0.22, 1, 0.36, 1)'
      blurTarget.style.willChange = 'filter, opacity'
    }
    if (mobileNavigationToggle) {
      mobileNavigationToggle.style.transition = 'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1)'
      mobileNavigationToggle.style.willChange = 'opacity'
    }

    const preventBackgroundScroll = (event: TouchEvent) => {
      const panel = mobileSheetPanelRef.current
      if (panel?.contains(event.target as Node)) return
      event.preventDefault()
    }

    document.addEventListener('touchmove', preventBackgroundScroll, { passive: false })

    return () => {
      document.removeEventListener('touchmove', preventBackgroundScroll)
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
      account_id: undefined,
      category_id: undefined,
      from_date: undefined,
      to_date: undefined,
    })
    onDateRangeReset()
    setIsMobileSheetOpen(false)
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
      <div ref={mobileSearchStickySentinelRef} aria-hidden className="h-px min-[1050px]:hidden" />
      <div
        ref={desktopToolbarRef}
        className={`sticky top-0 z-30 !mt-2 mb-2 flex flex-col gap-3 pb-2 pt-4 min-[1050px]:pt-5 ${desktopInlineLayout ? 'min-[750px]:flex-row min-[750px]:items-center' : ''}`}
        style={{
          background: 'var(--app-bg)',
          boxShadow: '0 0.25rem 0 var(--app-bg)',
        }}
      >
        <div
          className={`relative min-w-0 transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${mobileSearchStuck ? 'max-[1049px]:mr-14' : 'max-[1049px]:mr-0'} ${desktopInlineLayout ? 'min-[750px]:min-w-80 min-[750px]:flex-1' : ''}`}
        >
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--app-text-subtle)' }}
            aria-hidden
          />
          <input
            type="text"
            placeholder="Search transactions..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSearchSubmit()
            }}
            className="app-input h-11 w-full pl-9 min-[1050px]:h-10"
          />
        </div>

        <div className="flex w-full items-center gap-3 min-[750px]:hidden">
          <button
            type="button"
            className="app-secondary-button h-11 min-w-0 flex-1 justify-between"
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
            className="app-primary-button h-11 w-11 shrink-0 px-0"
            onClick={onCreateTransaction}
            aria-label="Add transaction"
          >
            <Plus size={18} aria-hidden />
          </button>
        </div>

        <div
          ref={desktopControlsRef}
          className={`relative hidden w-full flex-wrap items-center gap-3 min-[750px]:flex ${desktopInlineLayout ? 'min-[750px]:w-auto min-[750px]:flex-none min-[750px]:flex-nowrap' : ''}`}
        >
          <div
            ref={desktopFilterGroupRef}
            className={`flex min-w-0 flex-1 flex-wrap items-center gap-3 ${desktopInlineLayout ? 'min-[750px]:flex-none min-[750px]:flex-nowrap' : ''} ${desktopCreateStacked ? 'justify-between' : ''}`}
          >
            {showAccountFilter && (
              <FilterChip
                label="Account"
                selectedLabel={selectedAccountLabel}
                onClear={() => setFilter({ account_id: undefined })}
              >
                {(close) => (
                  <FilterOptionList
                    options={accountOptions}
                    selectedValue={filters.account_id}
                    onSelect={(value) => { setFilter({ account_id: value }); close() }}
                    searchPlaceholder="Search accounts..."
                    selectFirstSearchResultOnEnter
                  />
                )}
              </FilterChip>
            )}

            <FilterChip
              label="Category"
              selectedLabel={selectedCategoryLabel}
              onClear={() => setFilter({ category_id: undefined })}
            >
              {(close) => (
                <FilterOptionList
                  options={categoryOptions}
                  selectedValue={filters.category_id}
                  onSelect={(value) => { setFilter({ category_id: value }); close() }}
                  searchPlaceholder="Search categories..."
                  selectFirstSearchResultOnEnter
                />
              )}
            </FilterChip>

            <FilterChip
              label="Date range"
              selectedLabel={selectedDateLabel}
              onClear={() => setFilter({ from_date: undefined, to_date: undefined })}
              onClose={onDateRangeClose}
              panelAlign="right"
              panelClassName="w-[25rem] overflow-hidden"
            >
              {(close) => (
                <DateRangeFilterPanel
                  from={pendingFrom}
                  to={pendingTo}
                  changed={dateRangeChanged}
                  invalid={dateRangeInvalid}
                  onFromChange={onPendingFromChange}
                  onToChange={onPendingToChange}
                  onReset={onDateRangeReset}
                  onApply={close}
                />
              )}
            </FilterChip>
          </div>

          <button
            type="button"
            className={`app-primary-button h-10 shrink-0 ${desktopCreateStacked ? 'basis-full justify-center' : 'w-auto'}`}
            onClick={onCreateTransaction}
          >
            <Plus size={18} aria-hidden />
            <span>Add Transaction</span>
          </button>
          <button
            ref={desktopCreateMeasureRef}
            type="button"
            className="app-primary-button pointer-events-none invisible absolute h-10 w-auto shrink-0"
            tabIndex={-1}
            aria-hidden
          >
            <Plus size={18} aria-hidden />
            <span>Add Transaction</span>
          </button>
        </div>
      </div>

      {createPortal(
        <AnimatePresence onExitComplete={() => {
          if (!isMobileSheetOpen) setIsMobileBackdropActive(false)
        }}>
          {isMobileSheetOpen && (
            <div
              className="fixed inset-x-0 -top-[env(safe-area-inset-top)] bottom-0 z-[100] min-[750px]:hidden"
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
                aria-label="Transaction filters"
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
                  {showAccountFilter && (
                    <MobileFilterSection
                      title="Account"
                      options={accountOptions}
                      selectedValue={filters.account_id}
                      selectedLabel={selectedAccountLabel}
                      searchPlaceholder="Search accounts..."
                      allLabel="All accounts"
                      onSelect={(value) => setFilter({ account_id: value })}
                      onClear={() => setFilter({ account_id: undefined })}
                      selectFirstSearchResultOnEnter
                    />
                  )}
                  <MobileFilterSection
                    title="Category"
                    options={categoryOptions}
                    selectedValue={filters.category_id}
                    selectedLabel={selectedCategoryLabel}
                    searchPlaceholder="Search categories..."
                    allLabel="All categories"
                    onSelect={(value) => setFilter({ category_id: value })}
                    onClear={() => setFilter({ category_id: undefined })}
                    selectFirstSearchResultOnEnter
                  />
                  <MobileDateRangeSection
                    selectedLabel={selectedDateLabel}
                    from={pendingFrom}
                    to={pendingTo}
                    changed={dateRangeChanged}
                    invalid={dateRangeInvalid}
                    onFromChange={onPendingFromChange}
                    onToChange={onPendingToChange}
                    onReset={onDateRangeReset}
                    onApply={onDateRangeClose}
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

function MobileDateRangeSection({
  selectedLabel,
  from,
  to,
  changed,
  invalid,
  onFromChange,
  onToChange,
  onReset,
  onApply,
}: {
  selectedLabel: string | null
  from: string
  to: string
  changed: boolean
  invalid: boolean
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onReset: () => void
  onApply: () => void
}) {
  return (
    <section>
      <div className="mb-3 min-w-0">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-muted)' }}>
          Date range
        </h3>
        {selectedLabel && (
          <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--app-accent)' }}>
            {selectedLabel}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--app-border)' }}>
        <DateRangeFilterPanel
          from={from}
          to={to}
          changed={changed}
          invalid={invalid}
          onFromChange={onFromChange}
          onToChange={onToChange}
          onReset={onReset}
          onApply={onApply}
        />
      </div>
    </section>
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
      className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-[var(--app-surface-soft)]"
      style={{
        background: highlighted ? 'var(--app-surface-soft)' : 'transparent',
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
