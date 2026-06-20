import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Calendar,
  Check,
  ChevronDown,
  Coins,
  DollarSign,
  Search,
  SlidersHorizontal,
  Tag,
  Wallet,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { useAccounts } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useAuth } from '@/hooks/useAuth'
import { joinClassNames } from '@/utils/classNames'
import { formatMoneyInputLive, sanitizeMoneyInput } from '@/utils/moneyInput'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/pages/transactions/components/toolbar/types'

// Open width of the glass, wide enough to seat the seven facet tabs without crowding. The glass is
// anchored to its collapsed right edge, so opening grows this width leftward over the toolbar
const OPEN_WIDTH = 468

// Collapsed footprint used before the head is measured, so the toolbar slot does not jump on mount
const COLLAPSED_FALLBACK = { width: 140, height: 34 }

// Chrome around the measured content span in the collapsed pill: horizontal padding, the gap to
// the chevron, the chevron itself, and the borders, plus a couple of pixels so sub-pixel rounding
// never clips the label. Added to the content width to size the pill
const COLLAPSED_HEAD_CHROME = 64

// Lightly damped spring matching the insights range pill so both controls share a settle feel
const glassSpring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

type FacetKind = 'multi' | 'amount' | 'date'

type FacetConfig = {
  id: string
  label: string
  icon: LucideIcon
  kind: FacetKind
  // Single-select facets keep at most one value, so picking another replaces the previous one
  single?: boolean
}

const FACETS: FacetConfig[] = [
  { id: 'accounts', label: 'Accounts', icon: Wallet, kind: 'multi' },
  { id: 'categories', label: 'Category', icon: Tag, kind: 'multi' },
  { id: 'currency', label: 'Currency', icon: Coins, kind: 'multi', single: true },
  { id: 'amount', label: 'Amount', icon: DollarSign, kind: 'amount' },
  { id: 'date', label: 'Date', icon: Calendar, kind: 'date' },
]

type MultiSelections = Record<string, string[]>

const EMPTY_SELECTIONS: MultiSelections = {
  accounts: [],
  categories: [],
  currency: [],
}

type TransactionFilterPanelProps = {
  accountOptions: OptionItem[]
  categoryOptions: OptionItem[]
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
}

/**
 * Renders the unified transaction filter control, a collapsing glass pill whose panel opens as an
 * overlay anchored to the pill so it never shifts the toolbar height or the list below it
 */
export function TransactionFilterPanel({
  accountOptions,
  categoryOptions,
  filters,
  setFilter,
}: TransactionFilterPanelProps) {
  const [open, setOpen] = useState(false)
  const [activeFacetId, setActiveFacetId] = useState('accounts')
  const [selections, setSelections] = useState<MultiSelections>(EMPTY_SELECTIONS)
  const [amount, setAmount] = useState({ min: '', max: '' })
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [collapsedSize, setCollapsedSize] = useState(COLLAPSED_FALLBACK)
  const [contentHeight, setContentHeight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLButtonElement>(null)
  const headContentRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const { user } = useAuth()
  const { data: currencies = [] } = useCurrencies()
  const { data: accounts = [] } = useAccounts()

  // The currency filter offers the currencies the user's accounts actually use rather than every
  // ISO currency, and only one can be applied at a time
  const accountCurrencyCodes = Array.from(new Set(accounts.map((account) => account.currency)))
  const currencyOptions: OptionItem[] = accountCurrencyCodes.map((code) => ({ value: code, label: code }))
  const baseCurrency = user?.base_currency ?? ''

  // The amount range matches within one currency: the selected currency filter, or the base
  // currency when none is chosen, so the user never picks a currency twice
  const amountCurrency = selections.currency[0] ?? baseCurrency
  const amountSymbol = currencies.find((currency) => currency.id === amountCurrency)?.symbol ?? ''
  const amountCurrencyNote = selections.currency[0]
    ? `Amounts are matched in ${amountCurrency}, from the currency filter`
    : `Amounts are matched in ${amountCurrency}, your base currency`
  // Scopes the sliding-thumb layout animation to this instance
  const segId = useId()
  const shouldReduceMotion = useReducedMotion()
  const transition = shouldReduceMotion ? { duration: 0 } : glassSpring
  const activeFacetCount = FACETS.filter((facet) => countFacet(facet) > 0).length

  /**
   * Reseeds the draft from the applied filters so opening starts clean and dismissing discards any
   * uncommitted edits
   */
  const seedDraftFromFilters = useCallback(() => {
    setSelections({
      ...EMPTY_SELECTIONS,
      accounts: filters.account_id ?? [],
      categories: filters.category_id ?? [],
      currency: filters.currency ? [filters.currency] : [],
    })
    setDateRange({ from: filters.from_date ?? '', to: filters.to_date ?? '' })
    // Stored bounds are in the amount currency's minor units, so they are scaled back to a decimal
    const exponent = currencies.find((currency) => currency.id === filters.amount_currency)?.minor_unit_exponent ?? 2
    const toInput = (value?: number) => (value === undefined ? '' : String(value / 10 ** exponent))
    setAmount({ min: toInput(filters.min_amount), max: toInput(filters.max_amount) })
  }, [filters, currencies])

  /**
   * Closes the panel and reverts the draft to the applied filters, so clicking away or pressing
   * Escape takes no action rather than leaving uncommitted selections showing on the pill
   */
  const dismiss = useCallback(() => {
    seedDraftFromFilters()
    setOpen(false)
  }, [seedDraftFromFilters])

  // The glass is taken out of flow so its bloom overlays the page, so the wrapper is pinned to the
  // collapsed head size to hold the toolbar slot. Remeasured while collapsed since the count badge
  // changes the head width
  useLayoutEffect(() => {
    const head = headRef.current
    const content = headContentRef.current
    if (open || !head || !content) return
    // Measure the content span rather than the head, which stretches to the glass width and would
    // otherwise feed its own width back into the next measurement
    setCollapsedSize({
      width: Math.ceil(content.scrollWidth) + COLLAPSED_HEAD_CHROME,
      height: Math.ceil(head.offsetHeight) + 2,
    })
  }, [open, activeFacetCount])

  // The body height is animated as a real property rather than a layout transform, so the content
  // never scales and distorts. The observer keeps the target height in step with every content
  // change: switching facets, toggling selections, or filtering the checklist
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => setContentHeight(content.offsetHeight))
    observer.observe(content)
    setContentHeight(content.offsetHeight)
    return () => observer.disconnect()
  }, [])

  // An outside press or Escape dismisses the panel and discards the draft, so abandoning the panel
  // never commits or leaves uncommitted edits behind
  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        dismiss()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, dismiss])

  /**
   * Returns the option list backing a facet, falling back to the placeholder sets for the facets
   * the backend does not filter on yet
   */
  function getFacetOptions(facetId: string): OptionItem[] {
    if (facetId === 'accounts') return accountOptions
    if (facetId === 'categories') return categoryOptions
    return currencyOptions
  }

  /**
   * Counts the live selections on a facet so its tab can show a badge and the pill can show a
   * total
   */
  function countFacet(facet: FacetConfig): number {
    if (facet.kind === 'multi') return selections[facet.id].length
    if (facet.kind === 'amount') return amount.min || amount.max ? 1 : 0
    return dateRange.from || dateRange.to ? 1 : 0
  }

  /**
   * Seeds the draft from the currently applied filters, then opens the panel so reopening never
   * shows stale selections
   */
  function handleOpen() {
    seedDraftFromFilters()
    setOpen(true)
  }

  /**
   * Adds or removes a value from a multi-select facet draft
   */
  function toggleSelection(facetId: string, value: string) {
    setSelections((current) => {
      const values = current[facetId]
      const isSingle = FACETS.find((facet) => facet.id === facetId)?.single

      // A single-select facet keeps only the picked value, toggling off when the same one is tapped
      if (isSingle) {
        return { ...current, [facetId]: values.includes(value) ? [] : [value] }
      }
      const next = values.includes(value)
        ? values.filter((entry) => entry !== value)
        : [...values, value]
      return { ...current, [facetId]: next }
    })
  }

  /**
   * Clears every applied filter the list endpoint honours and dismisses the panel, so Clear all
   * resets the list rather than only emptying the draft
   */
  function clearAll() {
    setSelections(EMPTY_SELECTIONS)
    setAmount({ min: '', max: '' })
    setDateRange({ from: '', to: '' })
    setFilter({
      account_id: undefined,
      category_id: undefined,
      merchant_id: undefined,
      tag_id: undefined,
      tag_match: undefined,
      currency: undefined,
      min_amount: undefined,
      max_amount: undefined,
      amount_currency: undefined,
      from_date: undefined,
      to_date: undefined,
    })
    setOpen(false)
  }

  /**
   * Commits the draft, mapping the facets the list endpoint already supports into the applied
   * filters. Merchant, tag, currency, and amount stay draft-only until the backend list route
   * accepts them
   */
  function applyFilters() {
    // Amount bounds are committed in the matched currency's minor units to match how amounts are stored
    const exponent = currencies.find((currency) => currency.id === amountCurrency)?.minor_unit_exponent ?? 2
    const toMinor = (value: string) => (value.trim() ? Math.round(Number(value) * 10 ** exponent) : undefined)
    const hasAmount = Boolean(amount.min.trim() || amount.max.trim())

    setFilter({
      account_id: selections.accounts,
      category_id: selections.categories,
      currency: selections.currency[0],
      min_amount: toMinor(amount.min),
      max_amount: toMinor(amount.max),
      amount_currency: hasAmount ? amountCurrency : undefined,
      from_date: dateRange.from || undefined,
      to_date: dateRange.to || undefined,
    })
    setOpen(false)
  }

  const activeFacet = FACETS.find((facet) => facet.id === activeFacetId) ?? FACETS[0]
  // The collapsed pill swaps the chevron for a clear control once filters are applied, so the user
  // can reset without opening the panel while the rest of the pill still opens it
  const showClearButton = activeFacetCount > 0 && !open

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'relative', marginLeft: 'auto', width: collapsedSize.width, height: collapsedSize.height }}
    >
      <motion.div
        className="app-range-glass"
        style={{ position: 'absolute', top: 0, right: 0, maxWidth: '90vw', zIndex: 50, marginLeft: 0 }}
        initial={false}
        animate={{ width: open ? OPEN_WIDTH : collapsedSize.width }}
        transition={transition}
      >
        <button
          ref={headRef}
          type="button"
          className="app-range-glass-head"
          // Match the Add Transaction button: 40px outer height once the glass border is added,
          // with the same horizontal padding, gap, and text size
          style={{ height: 38, padding: '0 16px', gap: 8, fontSize: '0.9375rem' }}
          aria-expanded={open}
          aria-label="Transaction filters"
          onClick={() => (open ? setOpen(false) : handleOpen())}
        >
          <span ref={headContentRef} className="app-range-glass-cur">
            <SlidersHorizontal size={18} aria-hidden className="shrink-0" />
            <span>Filters</span>
            {activeFacetCount > 0 && (
              <span
                className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium"
                style={{ background: 'var(--app-accent)', color: 'var(--app-button-primary-text)' }}
              >
                {activeFacetCount}
              </span>
            )}
          </span>
          {!showClearButton && (
            <motion.span
              className="app-range-glass-chev"
              style={{ display: 'inline-flex' }}
              animate={{ rotate: open ? 180 : 0 }}
              transition={transition}
            >
              <ChevronDown size={16} aria-hidden />
            </motion.span>
          )}
        </button>

        {showClearButton && (
          <button
            type="button"
            aria-label="Clear all filters"
            className="app-range-glass-clear absolute inline-flex items-center justify-center"
            style={{ top: 5, right: 8, height: 28, width: 28, zIndex: 2 }}
            onClick={(event) => {
              event.stopPropagation()
              clearAll()
            }}
          >
            <X size={16} aria-hidden />
          </button>
        )}

        <motion.div
          style={{ overflow: 'hidden' }}
          initial={false}
          animate={{ height: open ? contentHeight : 0, opacity: open ? 1 : 0 }}
          transition={transition}
        >
          <div ref={contentRef} style={{ padding: '0 12px 12px' }}>
            <motion.div
              layout="position"
              transition={transition}
              className="app-range-seg"
              style={{ gridTemplateColumns: `repeat(${FACETS.length}, minmax(0, 1fr))` }}
              role="tablist"
              aria-label="Filter facets"
            >
                {FACETS.map((facet) => {
                  const FacetIcon = facet.icon
                  const facetCount = countFacet(facet)
                  const isActive = facet.id === activeFacetId
                  return (
                    <button
                      key={facet.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={joinClassNames(
                        'app-range-seg-option',
                        isActive && 'app-range-seg-option-active',
                      )}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                      onClick={() => setActiveFacetId(facet.id)}
                    >
                      {isActive && (
                        <motion.span
                          layoutId={`${segId}-facet`}
                          className="app-range-seg-thumb"
                          transition={transition}
                        />
                      )}
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

            <motion.div layout="position" transition={transition} className="mt-3">
              <FacetEditor
                facet={activeFacet}
                options={getFacetOptions(activeFacet.id)}
                selectedValues={selections[activeFacet.id] ?? []}
                amount={amount}
                amountSymbol={amountSymbol}
                amountCurrencyNote={amountCurrencyNote}
                dateRange={dateRange}
                onToggle={(value) => toggleSelection(activeFacet.id, value)}
                onAmountChange={setAmount}
                onDateRangeChange={setDateRange}
              />
            </motion.div>

            <motion.div layout="position" transition={transition}>
              <ActiveFilterSummary
                selections={selections}
                amount={amount}
                amountSymbol={amountSymbol}
                dateRange={dateRange}
                getFacetOptions={getFacetOptions}
                onRemoveSelection={toggleSelection}
                onClearAmount={() => setAmount({ min: '', max: '' })}
                onClearDate={() => setDateRange({ from: '', to: '' })}
              />
            </motion.div>

            <motion.div layout="position" transition={transition}>
              <p className="mt-2 px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                Transactions must match every filter you apply
              </p>
            </motion.div>

            <motion.div layout="position" transition={transition} className="mt-3 flex items-center justify-between">
              <button
                type="button"
                className="text-xs"
                style={{ color: 'var(--app-text-muted)' }}
                disabled={activeFacetCount === 0}
                onClick={clearAll}
              >
                Clear all
              </button>
              <button
                type="button"
                className="app-glass-button-primary"
                onClick={applyFilters}
              >
                Apply filters
              </button>
            </motion.div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}

type AmountDraft = { min: string; max: string }

type FacetEditorProps = {
  facet: FacetConfig
  options: OptionItem[]
  selectedValues: string[]
  amount: AmountDraft
  amountSymbol: string
  amountCurrencyNote: string
  dateRange: { from: string; to: string }
  onToggle: (value: string) => void
  onAmountChange: (value: AmountDraft) => void
  onDateRangeChange: (value: { from: string; to: string }) => void
}

/**
 * Renders the editor for the active facet, a chip grid for multi-select facets and labelled
 * inputs for the amount and date ranges
 */
function FacetEditor({
  facet,
  options,
  selectedValues,
  amount,
  amountSymbol,
  amountCurrencyNote,
  dateRange,
  onToggle,
  onAmountChange,
  onDateRangeChange,
}: FacetEditorProps) {
  if (facet.kind === 'amount') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
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
        <label className="flex flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
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
    )
  }

  if (facet.kind === 'date') {
    return (
      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          From
          <input
            type="date"
            className="app-input app-date-input-balanced"
            value={dateRange.from}
            onChange={(event) => onDateRangeChange({ ...dateRange, from: event.target.value })}
          />
        </label>
        <span className="pb-2.5 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          to
        </span>
        <label className="flex flex-1 flex-col gap-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
          To
          <input
            type="date"
            className="app-input app-date-input-balanced"
            value={dateRange.to}
            onChange={(event) => onDateRangeChange({ ...dateRange, to: event.target.value })}
          />
        </label>
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
    <div className="flex flex-col gap-1.5">
      {facet.single && (
        <p className="px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          Only one {facet.label.toLowerCase()} can be selected
        </p>
      )}
      <MultiSelectChecklist
        key={facet.id}
        options={options}
        selectedValues={selectedValues}
        searchPlaceholder={`Search ${facet.label.toLowerCase()}`}
        onToggle={onToggle}
      />
    </div>
  )
}

type MultiSelectChecklistProps = {
  options: OptionItem[]
  selectedValues: string[]
  searchPlaceholder: string
  onToggle: (value: string) => void
}

/**
 * Renders a searchable multi-select list, grouping adjacent options under sticky headers and
 * marking the selected rows with a check, mirroring the single-select filter list conventions
 */
function MultiSelectChecklist({
  options,
  selectedValues,
  searchPlaceholder,
  onToggle,
}: MultiSelectChecklistProps) {
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
    <div className="flex flex-col gap-1">
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

      <ul className="max-h-56 overflow-auto">
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
  amount: AmountDraft
  amountSymbol: string
  dateRange: { from: string; to: string }
  getFacetOptions: (facetId: string) => OptionItem[]
  onRemoveSelection: (facetId: string, value: string) => void
  onClearAmount: () => void
  onClearDate: () => void
}

/**
 * Renders the removable chips for every live selection across all facets, so the full filter
 * state stays visible while only one facet editor shows at a time
 */
function ActiveFilterSummary({
  selections,
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
      const label = getFacetOptions(facetId).find((option) => option.value === value)?.label ?? value
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
            transition={glassSpring}
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
              transition={glassSpring}
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
