import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Calendar, Check, ChevronDown, Search, X } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { joinClassNames } from '@/utils/classNames'
import { formatMoneyInputLive, sanitizeMoneyInput } from '@/utils/moneyInput'
import { ReferenceFacet } from '@/pages/transactions/components/toolbar/ReferenceFacet'
import {
  FILTER_FACETS,
  FILTER_GLASS_SPRING,
  type AmountDraft,
  type FacetConfig,
  type MultiSelections,
  type TransactionFilterDraft,
} from '@/pages/transactions/components/toolbar/useTransactionFilterDraft'

/**
 * Renders the shared filter panel body: the facet tabs, the active facet editor, the removable
 * active-filter chips, and the apply and clear actions, driven by the shared draft
 */
export function FilterPanelBody({
  draft,
  showFooter = true,
  mobile = false,
}: {
  draft: TransactionFilterDraft
  showFooter?: boolean
  // The mobile full-screen variant swaps the cramped facet tab grid for a dropdown and lets the
  // facet editor grow to fill the panel, while the desktop pill keeps the tabs and its measured
  // auto height with a capped list
  mobile?: boolean
}) {
  const [activeFacetId, setActiveFacetId] = useState('accounts')
  // Scopes the sliding-thumb layout animation to this instance
  const segId = useId()
  const shouldReduceMotion = useReducedMotion()
  const transition = shouldReduceMotion ? { duration: 0 } : FILTER_GLASS_SPRING
  const activeFacet = FILTER_FACETS.find((facet) => facet.id === activeFacetId) ?? FILTER_FACETS[0]

  // The mobile layout sizes the editor with flexbox, so the position springs are turned off to keep
  // framer-motion from fighting the flex sizing
  const blockLayout = mobile ? false : 'position'

  return (
    <div className={joinClassNames('contents', mobile && '!flex min-h-0 flex-1 flex-col')}>
      {mobile ? (
        <MobileFacetSelect
          activeFacetId={activeFacetId}
          countFacet={draft.countFacet}
          onSelect={setActiveFacetId}
        />
      ) : (
        <motion.div
          layout={blockLayout}
          transition={transition}
          className="app-range-seg app-filter-facet-grid"
          role="tablist"
          aria-label="Filter facets"
        >
          {FILTER_FACETS.map((facet) => {
            const FacetIcon = facet.icon
            const facetCount = draft.countFacet(facet)
            const isActive = facet.id === activeFacetId
            return (
              <button
                key={facet.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={joinClassNames('app-range-seg-option', isActive && 'app-range-seg-option-active')}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                onClick={() => setActiveFacetId(facet.id)}
              >
                {isActive && <motion.span layoutId={`${segId}-facet`} className="app-range-seg-thumb" transition={transition} />}
                <span className="app-range-seg-label" style={{ display: 'inline-flex' }}>
                  <FacetIcon size={16} aria-hidden />
                </span>
                <span className="app-range-seg-label" style={{ fontSize: '0.625rem' }}>
                  {facet.label}
                </span>
                {facetCount > 0 && (
                  <span
                    className="absolute flex h-[14px] min-w-[14px] items-center justify-center rounded-full px-1 text-[9px] font-medium"
                    style={{ top: 2, right: 2, zIndex: 1, background: 'var(--app-accent)', color: 'var(--app-button-primary-text)' }}
                  >
                    {facetCount}
                  </span>
                )}
              </button>
            )
          })}
        </motion.div>
      )}

      <motion.div
        layout={blockLayout}
        transition={transition}
        className={joinClassNames('mt-3', mobile && 'flex min-h-0 flex-1 flex-col')}
      >
        <FacetEditor
          facet={activeFacet}
          options={draft.getFacetOptions(activeFacet.id)}
          selectedValues={draft.selections[activeFacet.id] ?? []}
          referenceLabels={draft.referenceLabels}
          tagMatch={draft.tagMatch}
          amount={draft.amount}
          amountSymbol={draft.amountSymbol}
          amountCurrencyNote={draft.amountCurrencyNote}
          currencyOptions={draft.getFacetOptions('currency')}
          currencyValue={draft.selections.currency[0] ?? ''}
          dateRange={draft.dateRange}
          fillHeight={mobile}
          onToggle={(value, label) => draft.toggleSelection(activeFacet.id, value, label)}
          onCurrencyToggle={(value) => draft.toggleSelection('currency', value)}
          onTagMatchChange={draft.setTagMatch}
          onAmountChange={draft.setAmount}
          onDateRangeChange={draft.setDateRange}
        />
      </motion.div>

      <motion.div layout={blockLayout} transition={transition}>
        <ActiveFilterSummary
          selections={draft.selections}
          referenceLabels={draft.referenceLabels}
          amount={draft.amount}
          amountSymbol={draft.amountSymbol}
          dateRange={draft.dateRange}
          getFacetOptions={draft.getFacetOptions}
          onRemoveSelection={draft.toggleSelection}
          onClearAmount={() => draft.setAmount({ min: '', max: '' })}
          onClearDate={() => draft.setDateRange({ from: '', to: '' })}
        />
      </motion.div>

      <motion.div layout={blockLayout} transition={transition}>
        <p className="mt-2 px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          Transactions must match every filter you apply
        </p>
      </motion.div>

      {showFooter && (
        <motion.div layout={blockLayout} transition={transition} className="mt-3 flex items-center justify-between">
          <button
            type="button"
            className="text-xs"
            style={{ color: 'var(--app-text-muted)' }}
            disabled={draft.activeFacetCount === 0}
            onClick={draft.clearAll}
          >
            Clear all
          </button>
          <button type="button" className="app-glass-button-primary" onClick={draft.applyFilters}>
            Apply filters
          </button>
        </motion.div>
      )}
    </div>
  )
}

type MobileFacetSelectProps = {
  activeFacetId: string
  countFacet: (facet: FacetConfig) => number
  onSelect: (facetId: string) => void
}

/**
 * Renders the facet picker as a dropdown for the mobile full-screen panel, where the seven-way tab
 * grid is too cramped. The menu keeps the per-facet active-filter counts so the user can still tell
 * which facets carry filters without opening each one
 */
function MobileFacetSelect({ activeFacetId, countFacet, onSelect }: MobileFacetSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeFacet = FILTER_FACETS.find((facet) => facet.id === activeFacetId) ?? FILTER_FACETS[0]
  const ActiveIcon = activeFacet.icon
  const activeCount = countFacet(activeFacet)

  // Close the menu on a pointer down outside it, so a tap on the editor below dismisses the menu
  // without also closing the whole modal
  useEffect(() => {
    if (!open) return undefined

    function closeOnOutsidePointer(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="app-input flex w-full items-center justify-between gap-2"
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <ActiveIcon size={16} aria-hidden className="shrink-0" />
          <span className="truncate">{activeFacet.label}</span>
          {activeCount > 0 && <FacetCountBadge count={activeCount} />}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className="shrink-0 transition-transform duration-150"
          style={{ transform: open ? 'rotate(180deg)' : 'none', color: 'var(--app-text-subtle)' }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 max-h-[60vh] overflow-auto rounded-xl py-1"
            style={{
              background: 'var(--app-input-bg)',
              border: '1px solid var(--app-border-strong)',
              boxShadow: 'var(--app-shadow-soft)',
              backdropFilter: 'blur(16px)',
            }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {FILTER_FACETS.map((facet) => {
              const FacetIcon = facet.icon
              const facetCount = countFacet(facet)
              const isActive = facet.id === activeFacetId
              return (
                <li
                  key={facet.id}
                  role="option"
                  aria-selected={isActive}
                  className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--app-surface-soft)]"
                  style={{ color: isActive ? 'var(--app-accent)' : 'var(--app-text)', fontWeight: isActive ? 500 : 400 }}
                  onClick={() => {
                    onSelect(facet.id)
                    setOpen(false)
                  }}
                >
                  <FacetIcon size={16} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{facet.label}</span>
                  {facetCount > 0 && <FacetCountBadge count={facetCount} />}
                  {isActive && <Check size={15} aria-hidden className="shrink-0" />}
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Renders the small accent pill showing how many filters a facet currently holds
 */
function FacetCountBadge({ count }: { count: number }) {
  return (
    <span
      className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium"
      style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
    >
      {count}
    </span>
  )
}

type FacetEditorProps = {
  facet: FacetConfig
  options: OptionItem[]
  selectedValues: string[]
  referenceLabels: Record<string, string>
  tagMatch: 'all' | 'any'
  amount: AmountDraft
  amountSymbol: string
  amountCurrencyNote: string
  // The currency the amount range matches, chosen inside the amount section
  currencyOptions: OptionItem[]
  currencyValue: string
  dateRange: { from: string; to: string }
  fillHeight: boolean
  onToggle: (value: string, label?: string) => void
  onCurrencyToggle: (value: string) => void
  onTagMatchChange: (value: 'all' | 'any') => void
  onAmountChange: (value: AmountDraft) => void
  onDateRangeChange: (value: { from: string; to: string }) => void
}

/**
 * Renders the editor for the active facet: a searchable list for multi-select facets, a server
 * search for merchants and tags, and labelled inputs for the amount and date ranges
 */
function FacetEditor({
  facet,
  options,
  selectedValues,
  referenceLabels,
  tagMatch,
  amount,
  amountSymbol,
  amountCurrencyNote,
  currencyOptions,
  currencyValue,
  dateRange,
  fillHeight,
  onToggle,
  onCurrencyToggle,
  onTagMatchChange,
  onAmountChange,
  onDateRangeChange,
}: FacetEditorProps) {
  if (facet.kind === 'amount') {
    return (
      <div className="flex flex-col gap-3">
        {currencyOptions.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="px-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Currency
            </span>
            <div className="flex flex-wrap gap-1.5">
              {currencyOptions.map((option) => {
                const isSelected = option.value === currencyValue
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    className="rounded-full border px-3 py-1 text-sm transition-colors"
                    style={
                      isSelected
                        ? { background: 'var(--app-accent-soft)', borderColor: 'transparent', color: 'var(--app-accent)', fontWeight: 500 }
                        : { borderColor: 'var(--app-input-border)', color: 'var(--app-text)' }
                    }
                    onClick={() => onCurrencyToggle(option.value)}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="px-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
            Amount
          </span>
          <div className="flex items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Min
              <div className="relative">
                {amountSymbol && (
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {amountSymbol}
                  </span>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  className={joinClassNames('app-input', amountSymbol && 'pl-8')}
                  placeholder="0.00"
                  value={formatMoneyInputLive(amount.min)}
                  onChange={(event) => onAmountChange({ ...amount, min: sanitizeMoneyInput(event.target.value) })}
                />
              </div>
            </label>
            <span className="pb-2.5 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              to
            </span>
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Max
              <div className="relative">
                {amountSymbol && (
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    {amountSymbol}
                  </span>
                )}
                <input
                  type="text"
                  inputMode="decimal"
                  className={joinClassNames('app-input', amountSymbol && 'pl-8')}
                  placeholder="Any"
                  value={formatMoneyInputLive(amount.max)}
                  onChange={(event) => onAmountChange({ ...amount, max: sanitizeMoneyInput(event.target.value) })}
                />
              </div>
            </label>
          </div>
          <p className="px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {amountCurrencyNote}
          </p>
        </div>
      </div>
    )
  }

  if (facet.kind === 'date') {
    return (
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          From
          <div className="relative">
            <input
              type="date"
              className="app-input app-date-input-balanced pr-9"
              value={dateRange.from}
              onChange={(event) => onDateRangeChange({ ...dateRange, from: event.target.value })}
            />
            <Calendar
              size={15}
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--app-text-subtle)' }}
            />
          </div>
        </label>
        <span className="pb-2.5 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          to
        </span>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          To
          <div className="relative">
            <input
              type="date"
              className="app-input app-date-input-balanced pr-9"
              value={dateRange.to}
              onChange={(event) => onDateRangeChange({ ...dateRange, to: event.target.value })}
            />
            <Calendar
              size={15}
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--app-text-subtle)' }}
            />
          </div>
        </label>
      </div>
    )
  }

  if (facet.id === 'merchants' || facet.id === 'tags') {
    return (
      <div className={joinClassNames('flex flex-col gap-2', fillHeight && 'min-h-0 flex-1')}>
        {facet.id === 'tags' && (
          <div>
            <div className="app-range-seg" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              {(['all', 'any'] as const).map((mode) => {
                const isActive = tagMatch === mode
                return (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={isActive}
                    className={joinClassNames('app-range-seg-option', isActive && 'app-range-seg-option-active')}
                    style={isActive ? { background: 'var(--app-input-bg)', boxShadow: '0 1px 2px #00000014, inset 0 1px 0 color-mix(in srgb, white 28%, transparent)' } : undefined}
                    onClick={() => onTagMatchChange(mode)}
                  >
                    <span className="app-range-seg-label">{mode === 'all' ? 'All' : 'Any'}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1 px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
              {tagMatch === 'all' ? 'Match transactions with all selected tags' : 'Match transactions with any selected tag'}
            </p>
          </div>
        )}
        <ReferenceFacet
          kind={facet.id}
          selectedValues={selectedValues}
          selectedLabels={referenceLabels}
          searchPlaceholder={`Search ${facet.label.toLowerCase()}`}
          fillHeight={fillHeight}
          onToggle={onToggle}
        />
      </div>
    )
  }

  if (options.length === 0) {
    return (
      <p className="py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
        No {facet.label.toLowerCase()} available
      </p>
    )
  }

  return (
    <MultiSelectChecklist
      key={facet.id}
      options={options}
      selectedValues={selectedValues}
      searchPlaceholder={`Search ${facet.label.toLowerCase()}`}
      fillHeight={fillHeight}
      onToggle={onToggle}
    />
  )
}

type MultiSelectChecklistProps = {
  options: OptionItem[]
  selectedValues: string[]
  searchPlaceholder: string
  fillHeight: boolean
  onToggle: (value: string) => void
}

/**
 * Renders a searchable multi-select list, grouping adjacent options under sticky headers and
 * marking the selected rows with a check, mirroring the single-select filter list conventions
 */
function MultiSelectChecklist({ options, selectedValues, searchPlaceholder, fillHeight, onToggle }: MultiSelectChecklistProps) {
  const [search, setSearch] = useState('')

  const filtered = (() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => option.label.toLowerCase().includes(query))
  })()

  // Group adjacent items by their group label so each section gets one header, falling back to a
  // flat list when no option carries a group
  const grouped = (() => {
    if (!filtered.some((option) => option.group)) return null
    const groups: { label: string; items: OptionItem[] }[] = []
    let current: string | undefined
    for (const option of filtered) {
      if (option.group !== current || groups.length === 0) {
        current = option.group
        groups.push({ label: option.group ?? '', items: [] })
      }
      groups[groups.length - 1].items.push(option)
    }
    return groups
  })()

  return (
    <div className={joinClassNames('flex flex-col gap-1', fillHeight && 'min-h-0 flex-1')}>
      <div className="app-input grid grid-cols-[2.25rem_minmax(0,1fr)] items-center overflow-hidden px-0 py-0">
        <span className="pointer-events-none flex h-9 w-9 items-center justify-center">
          <Search size={14} style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
        </span>
        <input
          type="text"
          className="h-9 min-w-0 bg-transparent pr-3 text-[0.8125rem] outline-none"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <ul className={fillHeight ? 'min-h-0 flex-1 overflow-auto' : 'max-h-56 overflow-auto'}>
        {filtered.length === 0 ? (
          <li className="px-2 py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            No matches
          </li>
        ) : grouped ? (
          grouped.map((group) => (
            <li key={group.label}>
              <div
                className="sticky top-0 z-10 px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}
              >
                {group.label}
              </div>
              <ul>
                {group.items.map((option) => (
                  <ChecklistRow
                    key={option.value}
                    option={option}
                    selected={selectedValues.includes(option.value)}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            </li>
          ))
        ) : (
          filtered.map((option) => (
            <ChecklistRow
              key={option.value}
              option={option}
              selected={selectedValues.includes(option.value)}
              onToggle={onToggle}
            />
          ))
        )}
      </ul>
    </div>
  )
}

/**
 * Renders one checklist row, showing the option icon, its label, and a trailing check when selected
 */
function ChecklistRow({
  option,
  selected,
  onToggle,
}: {
  option: OptionItem
  selected: boolean
  onToggle: (value: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggle(option.value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--app-surface-soft)]"
        style={{ color: selected ? 'var(--app-accent)' : 'var(--app-text)', fontWeight: selected ? 500 : 400 }}
      >
        {option.icon && (
          <span className="shrink-0 text-base leading-none" aria-hidden>
            {option.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {selected && <Check size={15} aria-hidden className="shrink-0" />}
      </button>
    </li>
  )
}

type ActiveFilterSummaryProps = {
  selections: MultiSelections
  referenceLabels: Record<string, string>
  amount: AmountDraft
  amountSymbol: string
  dateRange: { from: string; to: string }
  getFacetOptions: (facetId: string) => OptionItem[]
  onRemoveSelection: (facetId: string, value: string) => void
  onClearAmount: () => void
  onClearDate: () => void
}

/**
 * Renders the removable chips for every live selection across all facets, so the full filter state
 * stays visible while only one facet editor shows at a time
 */
function ActiveFilterSummary({
  selections,
  referenceLabels,
  amount,
  amountSymbol,
  dateRange,
  getFacetOptions,
  onRemoveSelection,
  onClearAmount,
  onClearDate,
}: ActiveFilterSummaryProps) {
  const multiChips = Object.entries(selections).flatMap(([facetId, values]) =>
    values.map((value) => {
      // Client-list facets resolve via their options, server-searched ones via the label cache
      const label = getFacetOptions(facetId).find((option) => option.value === value)?.label ?? referenceLabels[value] ?? value
      return { key: `${facetId}:${value}`, label, onRemove: () => onRemoveSelection(facetId, value) }
    }),
  )

  const amountChip = amount.min || amount.max
    ? [{ key: 'amount', label: `${amountSymbol}${formatMoneyInputLive(amount.min) || '0'}–${formatMoneyInputLive(amount.max) || 'any'}`, onRemove: onClearAmount }]
    : []

  const dateChip = dateRange.from || dateRange.to
    ? [{ key: 'date', label: `${dateRange.from || '…'} → ${dateRange.to || '…'}`, onRemove: onClearDate }]
    : []

  const chips = [...multiChips, ...amountChip, ...dateChip]

  return (
    <div
      className="mt-3 flex min-h-[1.5rem] flex-wrap items-center gap-1.5 border-t pt-2.5"
      style={{ borderColor: 'var(--app-input-border)' }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {chips.length === 0 ? (
          <motion.span
            key="empty"
            layout
            className="text-xs"
            style={{ color: 'var(--app-text-subtle)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FILTER_GLASS_SPRING}
          >
            No filters applied
          </motion.span>
        ) : (
          chips.map((chip) => (
            <motion.span
              key={chip.key}
              layout
              className="inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-[11px]"
              style={{ background: 'color-mix(in srgb, var(--app-accent) 14%, transparent)', color: 'var(--app-accent)' }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={FILTER_GLASS_SPRING}
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                className="flex opacity-70 hover:opacity-100"
                onClick={chip.onRemove}
              >
                <X size={13} aria-hidden />
              </button>
            </motion.span>
          ))
        )}
      </AnimatePresence>
    </div>
  )
}
